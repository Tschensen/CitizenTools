function createHeightOverrides(slotIds, height) {
  return Object.fromEntries(slotIds.map((slotId) => [slotId, height]));
}

function rowIndexToLabel(rowIndex) {
  let index = Number(rowIndex);
  if (!Number.isInteger(index) || index < 0) return "";

  let label = "";
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);

  return label;
}

function createSlotRange(rowLabels, startCol, endCol) {
  const slots = [];
  for (const rowLabel of rowLabels) {
    for (let col = startCol; col <= endCol; col += 1) {
      slots.push(`${rowLabel}${col}`);
    }
  }
  return slots;
}

function createBlockedSlots(rows, cols, allowedSlots) {
  const allowed = new Set(allowedSlots);
  return createSlotRange(
    Array.from({ length: rows }, (_, index) => rowIndexToLabel(index)),
    1,
    cols,
  ).filter((slotId) => !allowed.has(slotId));
}

window.ShipPresets = {
  SHIP_PRESETS: {
    custom: {
      id: "custom",
      manufacturer: "",
      name: "Eigenes Raster",
      description: "Freies 3D-Raster für dein aktuelles Schiff oder einen komplett eigenen Laderaum.",
      cargoScu: null,
      rows: 4,
      cols: 6,
      defaultHeight: 3,
      blockedSlots: [],
      heightOverrides: {},
    },
    origin_315p: {
      id: "origin_315p",
      manufacturer: "Origin",
      name: "315p",
      description: "Kleiner Origin-Explorer mit zwei getrennten Frachträumen: 8 SCU vorne und 4 SCU hinten.",
      cargoScu: 12,
      rows: 8,
      cols: 4,
      defaultHeight: 1,
      blockedSlots: createBlockedSlots(8, 4, [
        "A2", "A3",
        "B2", "B3",
        "G2", "G3",
        "H2", "H3",
        "C2", "C3",
        "D2", "D3",
      ]),
      heightOverrides: {},
    },
    origin_400i: {
      id: "origin_400i",
      manufacturer: "Origin",
      name: "400i",
      description: "Eleganter Touring-Hauler mit einem einzelnen Frachtraum: 3 SCU breit, 7 SCU lang, 2 SCU hoch.",
      cargoScu: 42,
      rows: 9,
      cols: 5,
      defaultHeight: 2,
      blockedSlots: createBlockedSlots(9, 5, [
        "A2", "A3", "A4",
        "B2", "B3", "B4",
        "C2", "C3", "C4",
        "D2", "D3", "D4",
        "E2", "E3", "E4",
        "F2", "F3", "F4",
        "G2", "G3", "G4",
      ]),
      heightOverrides: {},
    },
    freelancer_max: {
      id: "freelancer_max",
      manufacturer: "MISC",
      name: "Freelancer MAX",
      description: "Cargo-Variante der Freelancer mit zwei kleinen vorderen Seitenholds und einem großen hinteren Hauptfrachtraum.",
      cargoScu: 120,
      rows: 12,
      cols: 6,
      defaultHeight: 3,
      blockedSlots: createBlockedSlots(12, 6, [
        "A1", "A6",
        "B1", "B6",
        "D2", "D3", "D4", "D5",
        "E2", "E3", "E4", "E5",
        "F2", "F3", "F4", "F5",
        "G2", "G3", "G4", "G5",
        "H2", "H3", "H4", "H5",
        "I2", "I3", "I4", "I5",
        "J2", "J3", "J4", "J5",
        "K2", "K3", "K4", "K5",
        "L2", "L3", "L4", "L5",
      ]),
      heightOverrides: {},
    },
    hermes: {
      id: "hermes",
      manufacturer: "RSI",
      name: "Hermes",
      description: "Schneller RSI-Hauler mit geteiltem Grid: links und rechts jeweils 4 SCU breit, 2 SCU hoch und langgezogenem Mitteldeck.",
      cargoScu: 288,
      rows: 18,
      cols: 9,
      defaultHeight: 2,
      blockedSlots: createBlockedSlots(18, 9, [
        "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9",
        "B1", "B2", "B3", "B4", "B6", "B7", "B8", "B9",
        "C1", "C2", "C3", "C4", "C6", "C7", "C8", "C9",
        "D1", "D2", "D3", "D4", "D6", "D7", "D8", "D9",
        "E1", "E2", "E3", "E4", "E6", "E7", "E8", "E9",
        "F1", "F2", "F3", "F4", "F6", "F7", "F8", "F9",
        "G1", "G2", "G3", "G4", "G6", "G7", "G8", "G9",
        "H1", "H2", "H3", "H4", "H6", "H7", "H8", "H9",
        "I1", "I2", "I3", "I4", "I6", "I7", "I8", "I9",
        "J1", "J2", "J3", "J4", "J6", "J7", "J8", "J9",
        "K1", "K2", "K3", "K4", "K6", "K7", "K8", "K9",
        "L1", "L2", "L3", "L4", "L6", "L7", "L8", "L9",
        "M1", "M2", "M3", "M4", "M6", "M7", "M8", "M9",
        "N1", "N2", "N3", "N4", "N6", "N7", "N8", "N9",
        "O1", "O2", "O3", "O4", "O6", "O7", "O8", "O9",
        "P1", "P2", "P3", "P4", "P6", "P7", "P8", "P9",
        "Q1", "Q2", "Q3", "Q4", "Q6", "Q7", "Q8", "Q9",
        "R1", "R2", "R3", "R4", "R6", "R7", "R8", "R9",
      ]),
      heightOverrides: {},
    },
    starlancer_max: {
      id: "starlancer_max",
      manufacturer: "MISC",
      name: "Starlancer MAX",
      description: "Moderner Deep-Space-Hauler mit zwei getrennten Frachträumen: vorne langes Doppeldeck, hinten zweigeteilter Hauptraum mit Einfahrt.",
      cargoScu: 224,
      rows: 26,
      cols: 5,
      defaultHeight: 2,
      blockedSlots: createBlockedSlots(26, 5, [
        "A1", "A2", "A4", "A5",
        "B1", "B2", "B4", "B5",
        "C1", "C2", "C4", "C5",
        "D1", "D2", "D4", "D5",
        "E1", "E2", "E4", "E5",
        "F1", "F2", "F4", "F5",
        "G1", "G2", "G4", "G5",
        "H1", "H2", "H4", "H5",
        "I1", "I2", "I4", "I5",
        "J1", "J2", "J4", "J5",
        "K1", "K2", "K4", "K5",
        "L1", "L2", "L4", "L5",
        "M1", "M2", "M4", "M5",
        "N1", "N2", "N4", "N5",
        "O1", "O2", "O4", "O5",
        "P1", "P2", "P4", "P5",
        "S1", "S2", "S4", "S5",
        "T1", "T2", "T4", "T5",
        "U1", "U2", "U4", "U5",
        "V1", "V2", "V4", "V5",
        "W1", "W2", "W4", "W5",
        "X1", "X2", "X4", "X5",
        "Y1", "Y2", "Y4", "Y5",
        "Z1", "Z2", "Z4", "Z5",
      ]),
      heightOverrides: {
        ...createHeightOverrides([
          "S1", "S2", "S4", "S5",
          "T1", "T2", "T4", "T5",
          "U1", "U2", "U4", "U5",
          "V1", "V2", "V4", "V5",
          "W1", "W2", "W4", "W5",
          "X1", "X2", "X4", "X5",
          "Y1", "Y2", "Y4", "Y5",
          "Z1", "Z2", "Z4", "Z5",
        ], 3),
      },
    },
    c2_hercules: {
      id: "c2_hercules",
      manufacturer: "Crusader",
      name: "C2 Hercules",
      description: "Schwerer Crusader-Hauler mit zwei Grid-Bereichen in einem großen Frachtraum: vorne 6x9x4, hinten 8x15x4.",
      cargoScu: 696,
      rows: 25,
      cols: 8,
      defaultHeight: 4,
      blockedSlots: createBlockedSlots(25, 8, [
        "A2", "A3", "A4", "A5", "A6", "A7",
        "B2", "B3", "B4", "B5", "B6", "B7",
        "C2", "C3", "C4", "C5", "C6", "C7",
        "D2", "D3", "D4", "D5", "D6", "D7",
        "E2", "E3", "E4", "E5", "E6", "E7",
        "F2", "F3", "F4", "F5", "F6", "F7",
        "G2", "G3", "G4", "G5", "G6", "G7",
        "H2", "H3", "H4", "H5", "H6", "H7",
        "I2", "I3", "I4", "I5", "I6", "I7",
        "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8",
        "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8",
        "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8",
        "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8",
        "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8",
        "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8",
        "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8",
        "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8",
        "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8",
        "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8",
        "U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8",
        "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8",
        "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8",
        "X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8",
        "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7", "Y8",
      ]),
      heightOverrides: {},
    },
  },
};
