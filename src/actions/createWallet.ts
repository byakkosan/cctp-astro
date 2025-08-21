import { defineAction } from 'astro:actions';
import { getSecret } from "astro:env/server";
import { z } from "astro:schema";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const client = initiateDeveloperControlledWalletsClient({
  apiKey: `${getSecret("API_KEY")}`,
  entitySecret: `${getSecret("ENTITY_SECRET")}`,
});

export const createWallet = {
  createWallet: defineAction({
    accept: "form",
    input: z.object({
      blockChain: z.string(),
    }),
    handler: async (input) => {
      const accountType = input.blockChain.startsWith("AVAX") ? "EOA" : "SCA";
      const response = await client.createWallets({
        blockchains: [`${input.blockChain}` as any],
        count: 1,
        accountType: accountType,
        walletSetId: `${getSecret("WALLET_SET_ID")}`,
      });
      return response.data;
    },
  }),
}