import { defineAction } from 'astro:actions';
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { pad } from "viem";
import { CCTP_CONFIG } from "../config/cctp.js";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: `${getSecret("API_KEY")}`,
  entitySecret: `${getSecret("ENTITY_SECRET")}`,
});

export const burnUsdc = {
  burnUsdc: defineAction({
    accept: "form",
    input: z.object({
      sourceWalletId: z.string(),
      destinationAddress: z.string(),
      transferAmount: z.number(),
    }),
    handler: async (input, context) => {
      const mintRecipientAddressInBytes32 = pad(input.destinationAddress as `0x${string}`);
      const usdcAmount = BigInt(input.transferAmount) * BigInt(10 ** 6);
      const maxFee = usdcAmount / BigInt(5000);
      const sourceChain = await context.session?.get("sourceChain") as keyof typeof CCTP_CONFIG.contracts;
      const sourceConfig = CCTP_CONFIG.contracts[sourceChain];
      const destinationChain = await context.session?.get("destinationChain") as keyof typeof CCTP_CONFIG.domains;
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
          id: burnTxResponse?.data?.id as string,
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
}