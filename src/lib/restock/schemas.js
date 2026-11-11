// Request and response shapes for the restock API. The route handlers validate
// with these, and src/lib/openapi.js turns them into the OpenAPI document, so
// the code and the docs read from one definition.
import { z } from "zod";
import { getMachineConfig, MACHINE_CONFIG, RESTOCK_EVENTS } from "./config.js";

const machineLabels = MACHINE_CONFIG.map((machine) => machine.label);

export const SecretKey = z.string().min(1).meta({
  description: "Shared RESTOCK_SECRET_KEY; wrong or missing returns 403.",
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
    description: `Machine label, case-insensitive. One of: ${machineLabels.join(", ")}.`,
    example: machineLabels[0],
  });

export const RestockEvent = z
  .enum([RESTOCK_EVENTS.load, RESTOCK_EVENTS.topoff, RESTOCK_EVENTS.clearout])
  .meta({
    description:
      "Load empties and refills every slot from the Production Plan. Topoff adds storage drinks to occupied slots. Clearout empties the machine.",
  });

export const RestockDataQuery = z
  .object({
    key: SecretKey,
    machine: MachineLabel,
    date: BatchDate,
    mode: z
      .string()
      .optional()
      .refine(
        (value) =>
          !value ||
          value.toLowerCase() === RESTOCK_EVENTS.clearout.toLowerCase(),
        "Invalid mode",
      )
      .meta({
        description:
          'Only "clearout" is accepted. Omit it and the event is chosen from what is already in the Restock Log: no Load yet gives Load, a Load but no Topoff gives Topoff.',
        example: "clearout",
      }),
  })
  .meta({ id: "RestockDataQuery" });

export const RestockSlot = z
  .object({
    slot: z.number().int().min(1).meta({
      example: 1,
      description:
        "Physical slot number, 1 to rows x columns of the machine (Nayax MDBCode).",
    }),
    previousDrink: z.string().nullable().meta({
      example: "Thai Tea 16oz Less Sugar w/ Lychee",
      description:
        "Full name of the drink Nayax reports in the slot now. Null when the slot is empty.",
    }),
    flavor: z.string().nullable().meta({
      description:
        "Flavor of the drink going in, e.g. Thai Tea. Null when nothing is planned for the slot.",
      example: "Thai Tea",
    }),
    size: z.string().nullable().meta({ example: "16oz" }),
    topping: z.string().nullable().meta({ example: "Lychee" }),
    sweetnessLevel: z.string().nullable().meta({ example: "Less Sugar" }),
    previous: z.number().int().min(0).meta({
      example: 3,
      description: "Drinks on hand now, from Nayax (PAR minus missing stock).",
    }),
    waste: z.number().int().min(0).meta({
      example: 3,
      description:
        "Prefilled drinks to throw out: previous on Load and Clearout, 0 on Topoff.",
    }),
    expectedNew: z.number().int().min(0).meta({
      example: 4,
      description:
        "Prefilled drinks to put in: Production Plan amount on Load, storage allocation on Topoff, 0 on Clearout.",
    }),
    total: z.number().int().min(0).meta({
      example: 4,
      description:
        "previous - waste + expectedNew, floored at 0. What Nayax will be told after submit.",
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
      "Something Nayax or a sheet returned that the service could not fully read. Extra fields name the slot or column involved.",
  });

export const RestockData = z
  .object({
    batchId: z.string().meta({
      description: "Machine label + batch date.",
      example: "30th-2026-07-10",
    }),
    event: RestockEvent,
    machine: MachineLabel,
    date: BatchDate,
    slots: z.array(RestockSlot).meta({
      description:
        "One entry per slot, always the machine's full slot count, in slot order.",
    }),
    warnings: z.array(RestockWarning),
  })
  .meta({ id: "RestockData" });

export const RestockSubmitSlot = z
  .object({
    slot: z.number().int().min(1).meta({ example: 1 }),
    waste: z.number().int().min(0).meta({
      example: 3,
      description: "Drinks thrown out, after the restocker's edits.",
    }),
    new: z.number().int().min(0).meta({
      example: 4,
      description: "Drinks put in, after the restocker's edits.",
    }),
  })
  .meta({ id: "RestockSubmitSlot" });

export const RestockSubmitBody = z
  .object({
    key: SecretKey,
    batchId: z.string().min(1).meta({ example: "30th-2026-07-10" }),
    event: RestockEvent,
    machine: MachineLabel,
    date: BatchDate,
    duration: z.string().optional().meta({
      description: "Time from opening the form to tapping Complete.",
      example: "5m 32s",
    }),
    slots: z.array(RestockSubmitSlot).meta({
      description:
        "Only slots the restocker approved. Empty slots are never sent.",
    }),
  })
  .meta({ id: "RestockSubmitBody" });

export const RestockSubmitResponse = z
  .object({
    success: z.literal(true),
    message: z.string().meta({ example: "Restock complete" }),
  })
  .meta({ id: "RestockSubmitResponse" });

export const ErrorResponse = z
  .object({
    error: z.string().meta({
      example: "Unknown machine",
      description: "Human-readable reason. Never includes upstream details.",
    }),
    existingEntryRow: z.number().int().optional().meta({
      example: 12,
      description:
        "409 only: Restock Log row of the entry that already exists.",
    }),
    existingEntryUrl: z
      .string()
      .optional()
      .meta({ description: "409 only: link to that row." }),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: "502 only: safe summary of the upstream failure." }),
  })
  .meta({ id: "ErrorResponse" });
