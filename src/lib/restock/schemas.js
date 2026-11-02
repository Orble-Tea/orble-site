// Request and response shapes for /api/restock. The route validates with
// these and src/lib/openapi.js renders them into the OpenAPI document, so the
// code and the docs read from one definition.
import { z } from "zod";
import {
  getMachineConfig,
  KITCHEN_LABEL,
  MACHINE_CONFIG,
  RESTOCK_EVENTS,
} from "./config.js";

const machineLabels = MACHINE_CONFIG.map((machine) => machine.label);

export const SecretKey = z.string().min(1).meta({
  description:
    "Shared RESTOCK_SECRET_KEY for auth. Wrong or missing returns 403.",
});

export const BatchDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({
    description:
      "Date the drinks were made (the batch date), YYYY-MM-DD. Not necessarily today.",
    example: "2026-07-10",
  });

export const MachineLabel = z
  .string()
  .refine((value) => Boolean(getMachineConfig(value)), "Unknown machine")
  .meta({
    description: `Case insensitive machine name. Current machine names: ${machineLabels.join(", ")}.`,
    example: machineLabels[0],
  });

export const BatchId = z
  .string()
  .min(1)
  .meta({
    description: `Machine name + batch date, or ${KITCHEN_LABEL} + batch date for a Split.`,
    example: `${machineLabels[0]}-2026-07-10`,
  });

const machineEvents = [
  RESTOCK_EVENTS.LOAD,
  RESTOCK_EVENTS.TOPOFF,
  RESTOCK_EVENTS.CLEAROUT,
];

export const MachineEvent = z.enum(machineEvents).meta({
  description:
    "Load empties and refills every slot from the Production Plan. Topoff adds the machine's split of storage to occupied slots. Clearout empties the machine.",
});

export const SplitEvent = z.literal(RESTOCK_EVENTS.SPLIT).meta({
  description: `Always ${RESTOCK_EVENTS.SPLIT} here. ${machineEvents.join(", ")} use the machine form.`,
});

export const RestockQuery = z
  .object({
    key: SecretKey,
    machine: MachineLabel,
    date: BatchDate,
    isClearout: z.enum(["true", "false"]).optional().meta({
      description:
        "true asks for a Clearout form. Omit it or send false and the event is determined by the entries in the Restock Log.",
      example: "false",
    }),
  })
  .meta({ id: "RestockQuery" });

const DrinkName = z.string().meta({
  description: "Full drink name as written in the sheets.",
  example: "Thai Tea 16oz Less Sweet w/ Lychee",
});

export const DrinkParts = z
  .object({
    flavor: z.string().meta({ example: "Thai Tea" }),
    size: z.string().nullish().meta({ example: "16oz" }),
    sweetness: z.string().nullish().meta({ example: "Less Sweet" }),
    topping: z.string().nullish().meta({ example: "Lychee" }),
  })
  .meta({ id: "DrinkParts", description: "A drink split into its parts." });

export const RestockSlot = z
  .object({
    slotNumber: z.number().int().min(1).meta({
      example: 1,
      description: "Physical slot number (Nayax MDBCode).",
    }),
    previousDrink: DrinkName.nullable().meta({
      description: "Drink Nayax reports in the slot now. Null when empty.",
    }),
    flavor: z.string().nullable().meta({
      example: "Thai Tea",
      description:
        "Flavor going in. Null when nothing is planned for the slot.",
    }),
    size: z.string().nullable().meta({ example: "16oz" }),
    topping: z.string().nullable().meta({ example: "Lychee" }),
    sweetness: z.string().nullable().meta({ example: "Less Sweet" }),
    previous: z.number().int().min(0).meta({
      example: 3,
      description: "Drinks on hand now, from Nayax.",
    }),
    waste: z.number().int().min(0).meta({
      example: 3,
      description:
        "Prefilled drinks to throw out: previous on Load and Clearout, 0 on Topoff.",
    }),
    expectedNew: z.number().int().min(0).meta({
      example: 4,
      description:
        "Prefilled drinks to put in: Production Plan amount on Load, storage split on Topoff, 0 on Clearout.",
    }),
    total: z.number().int().min(0).meta({
      example: 4,
      description: "previous - waste + expectedNew, floored at 0.",
    }),
  })
  .meta({ id: "RestockSlot" });

export const RestockWarning = z
  .looseObject({
    code: z.string().meta({ example: "MISSING_NAYAX_ON_HAND" }),
    message: z.string().meta({
      example:
        "Slot 3 has PAR 4, but Nayax did not return a readable on-hand count.",
    }),
  })
  .meta({
    id: "RestockWarning",
    description:
      "Something Nayax or a sheet returned that could not be fully read. Extra fields name the slot or column.",
  });

export const MachineForm = z
  .object({
    batchId: BatchId,
    event: MachineEvent,
    slots: z.array(RestockSlot).meta({
      description: "One entry per configured slot, in slot order.",
    }),
    warnings: z.array(RestockWarning),
  })
  .meta({
    title: "MachineForm",
    description: "The slot table for one machine and batch.",
  });

const splitShares = Object.fromEntries(
  MACHINE_CONFIG.map((machine) => [
    `to${machine.label}`,
    z
      .number()
      .int()
      .min(0)
      .meta({
        example: 3,
        description: `Cups of this drink going to ${machine.label}.`,
      }),
  ]),
);

export const SplitShare = z
  .object({
    drink: DrinkName,
    ...splitShares,
  })
  .meta({
    id: "SplitShare",
    title: "SplitShare",
    description: "One drink and how many cups go to each machine.",
  });

export const SplitDrink = SplitShare.extend({
  storage: z.number().int().min(0).meta({
    example: 6,
    description: "Cups of this drink in kitchen storage per the Inventory tab.",
  }),
}).meta({ id: "SplitDrink", title: "SplitDrink" });

export const SplitForm = z
  .object({
    batchId: BatchId.meta({ example: `${KITCHEN_LABEL}-2026-07-10` }),
    event: SplitEvent,
    drinks: z.array(SplitDrink),
    warnings: z.array(RestockWarning),
  })
  .meta({
    title: "SplitForm",
    description:
      "The kitchen's suggested split of storage between machines, from what every slot holds now.",
  });

export const RestockForm = z
  .union([MachineForm, SplitForm])
  .meta({ id: "RestockForm", title: "RestockForm" });

export const SubmittedSlot = z
  .object({
    slotNumber: z.number().int().min(1).meta({ example: 1 }),
    drink: DrinkParts.nullable().meta({
      description:
        "Drink in the slot after this restock. Null leaves it empty.",
    }),
    previousDrink: DrinkName.nullable(),
    previous: z.number().int().meta({ example: 3 }),
    waste: z.number().int().meta({
      example: 3,
      description: "Drinks thrown out, after the restocker's edits.",
    }),
    new: z.number().int().meta({
      example: 4,
      description: "Drinks put in, after the restocker's edits.",
    }),
    expected: z
      .object({
        drink: DrinkParts.nullable(),
        previousDrink: DrinkName.nullable(),
        previous: z.number().int(),
        waste: z.number().int(),
        new: z.number().int(),
      })
      .optional()
      .meta({
        description:
          "The prefill the page showed before edits, logged as the Expected columns.",
      }),
  })
  .meta({ id: "SubmittedSlot" });

export const MachineSubmit = z
  .object({
    key: SecretKey,
    batchId: BatchId,
    event: MachineEvent,
    duration: z.string().optional().meta({
      example: "5m 32s",
      description: "Time from opening the form to tapping Complete.",
    }),
    slots: z.array(SubmittedSlot).meta({
      description: "Every configured slot exactly once, empties included.",
    }),
  })
  .meta({
    title: "MachineSubmit",
    description: "A form submitted at the machine.",
  });

export const SplitSubmit = z
  .object({
    key: SecretKey,
    batchId: BatchId.meta({ example: `${KITCHEN_LABEL}-2026-07-10` }),
    event: SplitEvent,
    duration: z.string().optional().meta({ example: "1m 10s" }),
    drinks: z
      .array(SplitShare)
      .meta({ description: "Every drink on the date's Inventory tab." }),
  })
  .meta({
    title: "SplitSubmit",
    description:
      "A form submitted after splitting drinks by location in the kitchen.",
  });

export const RestockSubmit = z
  .discriminatedUnion("event", [SplitSubmit, MachineSubmit])
  .meta({ id: "RestockSubmit", title: "RestockSubmit" });

export const SubmitResponse = z
  .object({
    success: z.literal(true),
    message: z.string().meta({ example: "Restock complete" }),
  })
  .meta({ id: "SubmitResponse" });

export const ErrorResponse = z
  .object({
    error: z.string().meta({
      example: "Unknown machine",
      description: "Human-readable reason. Never includes upstream details.",
    }),
    details: z.record(z.string(), z.unknown()).optional().meta({
      description:
        "Where it helps: the existing Restock Log row for a 409, or a safe summary of a 502.",
    }),
  })
  .meta({ id: "ErrorResponse" });
