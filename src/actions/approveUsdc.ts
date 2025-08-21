import { defineAction } from 'astro:actions';
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { CCTP_CONFIG } from "../config/cctp.js";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: `${getSecret("API_KEY")}`,
  entitySecret: `${getSecret("ENTITY_SECRET")}`,
});

export const approveUsdc = {
  approveUsdc: defineAction({
    accept: "form",
    input: z.object({
      sourceWalletId: z.string(),
      authorizedAmount: z.number(),
    }),
    handler: async (input, context) => {
      const sourceChain = await context.session?.get("sourceChain") as keyof typeof CCTP_CONFIG.contracts;
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
          id: approveTxResponse?.data?.id as string,
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
}