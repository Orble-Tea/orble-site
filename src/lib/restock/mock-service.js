const MOCK_SLOTS = [
  {
    slot: 1,
    flavor: "Thai Tea",
    size: "16oz",
    topping: "Lychee",
    sweetness: "Less Sweet",
    previous: 3,
    waste: 3,
    new: 4,
    empty: false,
  },
  {
    slot: 2,
    flavor: "Taro",
    size: "22oz",
    topping: "None",
    sweetness: "Normal",
    previous: 1,
    waste: 1,
    new: 4,
    empty: false,
  },
  {
    slot: 3,
    flavor: "Brown Sugar Milk Tea",
    size: "16oz",
    topping: "Boba",
    sweetness: "Normal",
    previous: 0,
    waste: 0,
    new: 4,
    empty: false,
  },
];

function emptySlot(slot) {
  return {
    slot,
    flavor: null,
    size: null,
    topping: null,
    sweetness: null,
    previous: 0,
    waste: 0,
    new: 0,
    empty: true,
  };
}

export function buildMockRestockData(machineConfig, date) {
  const filledSlots = new Map(MOCK_SLOTS.map((slot) => [slot.slot, slot]));
  return {
    batchId: `${machineConfig.label}-${date}`,
    event: "Load",
    machine: machineConfig.label,
    date,
    slots: Array.from({ length: 35 }, (_, index) => {
      const slot = index + 1;
      return filledSlots.get(slot) || emptySlot(slot);
    }),
  };
}

export function buildMockPicklist(date) {
  return {
    date,
    machines: [
      {
        machine: "Towne",
        items: [
          { drink: "Thai Tea Less Sweet w/ Lychee 16oz", quantity: 6 },
          { drink: "Taro Normal 22oz", quantity: 4 },
        ],
      },
      {
        machine: "30th",
        items: [
          { drink: "Thai Tea Less Sweet w/ Lychee 16oz", quantity: 1 },
          { drink: "Brown Sugar Milk Tea Normal w/ Boba 16oz", quantity: 2 },
        ],
      },
    ],
  };
}

export function submitMockRestock(payload) {
  return {
    success: true,
    message: "Restock complete",
    mock: true,
    received: {
      batchId: payload.batchId,
      event: payload.event,
      machine: payload.machine,
      date: payload.date,
      duration: payload.duration || "",
      slots: payload.slots || [],
    },
  };
}
