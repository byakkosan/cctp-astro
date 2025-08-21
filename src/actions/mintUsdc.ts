import { defineAction } from 'astro:actions';
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { CCTP_CONFIG } from "../config/cctp.js";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: `${getSecret("API_KEY")}`,
  entitySecret: `${getSecret("ENTITY_SECRET")}`,
});

export const mintUsdc = {
  mintUsdc: defineAction({
    accept: "form",
    input: z.object({
      recipientWalletId: z.string(),
      maskedMessage: z.string(),
      maskedAttestation: z.string(),
    }),
    handler: async (input, context) => {
      const destinationChain = await context.session?.get("destinationChain") as keyof typeof CCTP_CONFIG.contracts;
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
          id: receiveTxResponse?.data?.id as string,
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
}