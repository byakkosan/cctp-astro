import { defineAction } from "astro:actions";
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { pad } from "viem";
import { CCTP_CONFIG } from "../config/cctp.js";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: `${getSecret("API_KEY")}`,
  entitySecret: `${getSecret("ENTITY_SECRET")}`,
});

export const server = {
  createWallet: defineAction({
    accept: "form",
    input: z.object({
      blockChain: z.string(),
    }),
    handler: async (input) => {
      const accountType = input.blockChain.startsWith("AVAX") ? "EOA" : "SCA";
      const response = await client.createWallets({
        blockchains: [`${input.blockChain}`],
        accountType: accountType,
        walletSetId: `${getSecret("WALLET_SET_ID")}`,
      });
      return response.data;
    },
  }),
  initialSetup: defineAction({
    accept: "form",
    input: z.object({
      sourceChain: z.string(),
      destinationChain: z.string(),
    }),
    handler: async (input) => {
      return input;
    },
  }),
  approveUsdc: defineAction({
    accept: "form",
    input: z.object({
      sourceWalletId: z.string(),
      authorizedAmount: z.number(),
    }),
    handler: async (input, context) => {
      const sourceChain = await context.session?.get("sourceChain");
      const usdcAmount = BigInt(input.authorizedAmount) * BigInt(10 ** 6);
      const sourceConfig = CCTP_CONFIG.contracts[sourceChain];
      const approveTxResponse = await client.createContractExecutionTransaction({
        walletId: input.sourceWalletId,
        contractAddress: sourceConfig.usdc,
        abiFunctionSignature: "approve(address,uint256)",
        abiParameters: [sourceConfig.tokenMessenger, usdcAmount.toString()],
        fee: {
          type: "level",
          config: {
            feeLevel: "LOW",
          },
        },
      });
      console.log("Approve transaction response:", approveTxResponse.data);

      let approveTxStatus;
      do {
        const statusResponse = await client.getTransaction({
          id: approveTxResponse?.data?.id,
        });
        approveTxStatus = statusResponse?.data?.transaction?.state;
        if (approveTxStatus === "FAILED") {
          throw new Error("Approve transaction failed");
        }
        if (approveTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } while (approveTxStatus !== "CONFIRMED");
      console.log("approve txn", approveTxStatus);

      const info = {
        ...approveTxResponse.data,
        sourceWalletId: input.sourceWalletId,
        authorizedAmount: input.authorizedAmount,
      };
      return info;
    },
  }),
  burnUsdc: defineAction({
    accept: "form",
    input: z.object({
      sourceWalletId: z.string(),
      destinationAddress: z.string(),
      transferAmount: z.number(),
    }),
    handler: async (input, context) => {
      const mintRecipientAddressInBytes32 = pad(input.destinationAddress);
      const usdcAmount = BigInt(input.transferAmount) * BigInt(10 ** 6);
      const maxFee = usdcAmount / BigInt(5000);
      const sourceChain = await context.session?.get("sourceChain");
      const sourceConfig = CCTP_CONFIG.contracts[sourceChain];
      const destinationChain = await context.session?.get("destinationChain");
      const destinationDomain = CCTP_CONFIG.domains[destinationChain];
      const burnTxResponse = await client.createContractExecutionTransaction({
        walletId: input.sourceWalletId,
        contractAddress: sourceConfig.tokenMessenger,
        abiFunctionSignature: "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
        abiParameters: [
          usdcAmount.toString(),
          destinationDomain.toString(),
          mintRecipientAddressInBytes32,
          sourceConfig.usdc,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          maxFee.toString(),
          "1000",
        ],
        fee: {
          type: "level",
          config: {
            feeLevel: "MEDIUM",
          },
        },
      });
      console.log("Burn transaction response:", burnTxResponse?.data?.id);
      // Wait for transaction to be confirmed
      let burnTxStatus;
      let statusResponse;
      do {
        statusResponse = await client.getTransaction({
          id: burnTxResponse?.data?.id,
        });
        burnTxStatus = statusResponse?.data?.transaction?.state;
        console.log(burnTxStatus);
        if (burnTxStatus === "FAILED") {
          throw new Error("Burn transaction failed");
        }
        if (burnTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } while (burnTxStatus !== "CONFIRMED");

      const info = {
        ...burnTxResponse.data,
        recipientAddress: input.destinationAddress,
        transferAmount: input.transferAmount,
        txHash: statusResponse?.data?.transaction?.txHash,
      };
      return info;
    },
  }),
  receiveAttestation: defineAction({
    accept: "form",
    input: z.object({
      maskedTxHash: z.string(),
    }),
    handler: async (input, context) => {
      const sourceChain = await context.session?.get("sourceChain");
      const sourceDomainId = CCTP_CONFIG.domains[sourceChain];
      const txHash = await context.session?.get("txHash");

      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Starting attestation polling...");

      const attestation = await waitForAttestation(sourceDomainId.toString(), txHash);

      async function waitForAttestation(sourceDomainId: any, txHash: any) {
        const maxAttempts = 30; // 5 minutes total with 10-second intervals
        let attempts = 0;

        try {
          while (attempts < maxAttempts) {
            attempts++;
            const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomainId}?transactionHash=${txHash}`;
            const options = {
              method: "GET",
              headers: {
                Authorization: `Bearer ${getSecret("API_KEY")}`,
                "Content-Type": "application/json",
              },
            };

            try {
              const response = await fetch(url, options);
              const json = await response.json();

              console.log("Attestation response:", json.messages);
              console.log("Attestation response without", response);

              if (json?.messages?.[0]?.status === "complete") {
                const { message, attestation } = json?.messages[0];
                return { message, attestation };
              }
            } catch (error) {
              if (error.response?.status === 404) {
                console.log(`Attempt ${attempts}/${maxAttempts}: Attestation not ready yet`);
              } else {
                throw error;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 10000));
          }
          throw new Error("Timeout waiting for attestation");
        } catch (error) {
          console.error(`Failed to get attestation: ${error}`);
          throw error;
        }
      }
      console.log("Attestation received:", attestation);

      const info = {
        message: attestation.message,
        attestation: attestation.attestation,
      };
      return info;
    },
  }),
  mintUsdc: defineAction({
    accept: "form",
    input: z.object({
      recipientWalletId: z.string(),
      maskedMessage: z.string(),
      maskedAttestation: z.string(),
    }),
    handler: async (input, context) => {
      const destinationChain = await context.session?.get("destinationChain");
      const message = await context.session?.get("message");
      const attestation = await context.session?.get("attestation");

      const destinationDomain = CCTP_CONFIG.contracts[destinationChain];
      const receiveTxResponse = await client.createContractExecutionTransaction({
        walletId: input.recipientWalletId,
        contractAddress: destinationDomain.messageTransmitter,
        abiFunctionSignature: "receiveMessage(bytes,bytes)",
        abiParameters: [message, attestation],
        fee: {
          type: "level",
          config: {
            feeLevel: "MEDIUM",
          },
        },
      });
      console.log("Receive transaction response:", receiveTxResponse.data);

      // Wait for transaction to be confirmed
      let receiveTxStatus;
      do {
        const statusResponse = await client.getTransaction({
          id: receiveTxResponse?.data?.id,
        });
        receiveTxStatus = statusResponse?.data?.transaction?.state;
        console.log("Receive transaction status:", receiveTxStatus);
        if (receiveTxStatus === "FAILED") {
          throw new Error("Receive transaction failed");
        }
        if (receiveTxStatus !== "CONFIRMED") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } while (receiveTxStatus !== "CONFIRMED");
      const info = {
        ...receiveTxResponse.data,
      };
      return info;
    },
  }),
};
