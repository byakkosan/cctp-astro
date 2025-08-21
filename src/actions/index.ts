import { defineAction } from "astro:actions";
import { z } from "astro:schema";

import { approveUsdc } from "./approveUsdc.js";
import { burnUsdc } from "./burnUsdc.js";
import { receiveAttestation } from "./receiveAttestation.js";
import { mintUsdc } from "./mintUsdc.js";
import { createWallet } from "./createWallet.js";

export const server = {
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
  approveUsdc,
  burnUsdc,
  receiveAttestation,
  mintUsdc,
  createWallet
};
