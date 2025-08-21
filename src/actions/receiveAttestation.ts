import { defineAction } from 'astro:actions';
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { CCTP_CONFIG } from "../config/cctp.js";

export const receiveAttestation = {
  receiveAttestation: defineAction({
    accept: "form",
    input: z.object({
      maskedTxHash: z.string(),
    }),
    handler: async (input, context) => {
      const sourceChain = await context.session?.get("sourceChain") as keyof typeof CCTP_CONFIG.domains;
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
              if ((error as any).response?.status === 404) {
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
}