# Restock start log

![Restock start log flow](./restock-get.png)

<details>
<summary>Mermaid source (render with mermaid@11 to regenerate the PNG)</summary>

```mermaid
%%{init: {"flowchart": {"rankSpacing": 35, "nodeSpacing": 40, "wrappingWidth": 360}}}%%
flowchart TD
  A([Start log pressed]) --> Q1{Is the inbound request valid?}
  Q1 -- "No, the key, machine, date or mode is wrong" --> R0["invalidKey / unknownMachine / invalidDate /<br/>machineNotConfigured / invalidMode"]
  Q1 -- "Yes, so we read the Restock Log for the machine's batch<br/>(#lt;machine#gt;-#lt;date#gt;) and the kitchen's (Kitchen-#lt;date#gt;)" --> Q2{"Does the machine's batch have a row<br/>stuck at Nayax pending?<br/>(Load or Topoff; Clearout when mode=clearout)"}

  Q2 -- "Yes, the last Complete press never finished" --> OK0(["200 the stored submit as the prefill,<br/>so Complete resends the same slots"])
  Q2 -- No --> EV{"Which event comes next?"}
  EV -- "mode=clearout" --> C[Clearout]
  EV -- "No Load row yet" --> L[Load]
  EV -- "Load row, and a Topoff row<br/>or a Kitchen Split row" --> T[Topoff]
  EV -- "Load row, no Topoff row,<br/>no Kitchen Split row" --> S[Split]

  C --> Q3
  L --> Q3
  T --> Q3
  S --> Q3
  Q3{"Do the batch rules allow this event?"}
  Q3 -- "No, the log says this batch was already cleared out" --> R2[batchClearedOut]
  Q3 -- "No, the machine already has a newer batch" --> R7[batchSuperseded]
  Q3 -- "No, the event is not a Load<br/>but the Load is not Complete" --> R4[needsEventFirst]
  Q3 -- Yes --> Q4{"Does the batch already have<br/>a Complete row for this event?"}
  Q4 -- Yes --> R8[batchFullyLogged]

  Q4 -- "No, Split: read the Inventory tab<br/>and both machines' Nayax slots" --> S1
  Q4 -- "No, Load: read the machine's Nayax slots<br/>and the Production Plan" --> L1
  Q4 -- "No, Topoff: read the machine's Nayax slots<br/>and the Inventory tab" --> T1
  Q4 -- "No, Clearout: read the machine's Nayax slots" --> C1

  subgraph SP [Split]
  S1{"Can every Inventory drink<br/>with Storage > 0 be read?"}
  S1 -- Yes --> S2["Level each drink's storage over the slots holding it,<br/>lowest slot first, on both machines.<br/>2+ cups left: open an empty slot, only on a machine<br/>that already sells the drink. A slot whose<br/>Nayax name cannot be read counts as empty"]
  S2 --> OKS(["200 Split: one row per Inventory drink<br/>with storage, to30th, toTowne"])
  end

  subgraph LD [Load]
  L1{"Can every Production Plan drink<br/>with an amount for this machine be read?"}
  L1 -- Yes --> L2["Every slot: waste = cups in it now, drink cleared.<br/>Each plan row's amount spread lowest-first<br/>over the row's slots, with the plan's drink"]
  L2 --> OKL(["200 Load slots<br/>(warning when the machine's last batch<br/>was never cleared out)"])
  end

  subgraph TP [Topoff]
  T1{"Can every Inventory drink with<br/>a To #lt;machine#gt; amount be read?"}
  T1 -- Yes --> T2["Level each drink's To amount over this machine's<br/>slots holding it, lowest slot first.<br/>2+ cups left: open an empty slot and give it the drink"]
  T2 --> OKT([200 Topoff slots])
  end

  subgraph CL [Clearout]
  C1["Every slot: waste = cups in it now, new 0"]
  C1 --> OKC([200 Clearout slots])
  end

  S1 -- No --> R9[sheetDrinksInvalid]
  L1 -- No --> R9
  T1 -- No --> R9
  S1 -. "no Inventory tab for the date" .-> R10[noInventoryForBatch]
  T1 -. "no Inventory tab for the date" .-> R10

  Q2 -. "Sheets read fails" .-> X[502]
  SP -. "Nayax or Sheets fails" .-> X
  LD -. "Nayax or Sheets fails" .-> X
  TP -. "Nayax or Sheets fails" .-> X
  CL -. "Nayax fails" .-> X

  classDef reject fill:#fde2e1,stroke:#b42318,color:#7a271a
  classDef ok fill:#d1fadf,stroke:#027a48,color:#054f31
  class R0,R2,R4,R7,R8,R9,R10,X reject
  class OK0,OKS,OKL,OKT,OKC ok
```

</details>

A slot whose Nayax record has no readable drink name or no on-hand count is
still returned, with a warning on it, so the restocker can fix it on the phone.
Warnings never turn the response into an error.
