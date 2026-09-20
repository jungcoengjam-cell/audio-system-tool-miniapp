const MANUALS = {
  ktP: 'itc产品说明书 KT-P21000 KT-P21200.pdf',
  tc22000: 'itc产品说明书 TC-22000@V20241018.pdf',
  tcB: 'itc产品说明书 TC-2200B TC-2350B TC-2500B@V20251125.pdf',
  tc23000: 'itc产品说明书 TC-23000@V20241018.pdf',
  tc2500: 'itc产品说明书 TC-2500 TC-2700@V20240507.pdf',
  tc2700B: 'itc产品说明书 TC-2700B@V20241018.pdf',
  tc41200: 'itc产品说明书 TC-41200@V20250816.pdf',
  tc41500: 'itc产品说明书 TC-41500@V20250816.pdf',
  tc41500Dt: 'itc产品说明书 TC-41500DT@V20241018.pdf',
  tc4200B: 'itc产品说明书 TC-4200B TC-4350B@V20240507.pdf',
  tc4500: 'itc产品说明书 TC-4500 TC-4700@V20250816.pdf',
  tc4500B: 'itc产品说明书 TC-4500B@V20260415.pdf',
  tc4500Dt: 'itc产品说明书 TC-4500DT TC-4700DT@V20241018.pdf',
  tcD: 'itc产品说明书 TC-D4200 TC-D4350 TC-D4500@V20241114.pdf',
  tcXB: 'itc产品说明书 TC-X2200B TC-X2350B TC-X2500B TC-X2700B@V20250326.pdf',
  tcX: 'itc产品说明书 TC-X2500 TC-X2700 TC-X21000 TC-X21200 TC-X22000@V20250326.pdf',
  tcX4B: 'itc产品说明书 TC-X4200B TC-X4350B@V20250801.pdf',
  tcX4: 'itc产品说明书 TC-X4500 TC-X4700 TC-X41200 TC-X41500@V20250801.pdf',
}

function verifiedStage(controlType, unit, values, source, sourcePages, extra = {}) {
  return {
    controlType,
    unit,
    options: values,
    source,
    sourcePages,
    verification: 'manual-page',
    verifiedOn: '2026-07-25',
    ...extra,
  }
}

const amplifierInputStages = {
  'KT-P21000': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.ktP, [5, 12], {
    ratedVoltageGainDb: 39,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'KT-P21200': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.ktP, [5, 12], {
    ratedVoltageGainDb: 41,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-22000': verifiedStage('voltageGain', 'dB', [33, 36, 39, 42], MANUALS.tc22000, [6]),
  'TC-2200B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcB, [7, 13], {
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-23000': verifiedStage('voltageGain', 'dB', [35, 38, 41, 44], MANUALS.tc23000, [6, 12]),
  'TC-2350B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcB, [7, 13], {
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-2500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc2500, [5, 6, 12], {
    ratedVoltageGainDb: 36,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-2500B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcB, [7, 13], {
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-2700': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc2500, [5, 6, 12], {
    ratedVoltageGainDb: 37.5,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-2700B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc2700B, [7, 13], {
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-41200': verifiedStage('voltageGain', 'dB', [31, 34, 37, 40], MANUALS.tc41200, [6, 12], {
    referenceInputSensitivityV: 1,
  }),
  'TC-41500': verifiedStage('voltageGain', 'dB', [32, 35, 38, 41], MANUALS.tc41500, [6, 12]),
  'TC-41500DT': verifiedStage('inputSensitivity', 'dBu', [2, 6, 12], MANUALS.tc41500Dt, [6, 7, 9, 10, 11], {
    maximumInputDbu: 20,
  }),
  'TC-4200B': verifiedStage('inputSensitivity', 'V', [1], MANUALS.tc4200B, [12], {
    sourceValueLabels: ['2.2 dBu (1 V)'],
  }),
  'TC-4350B': verifiedStage('inputSensitivity', 'V', [1], MANUALS.tc4200B, [12], {
    sourceValueLabels: ['2.2 dBu (1 V)'],
  }),
  'TC-4500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc4500, [5, 6, 12], {
    ratedVoltageGainDb: 36,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-4500B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc4500B, [6, 12], {
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-4500DT': verifiedStage('inputSensitivity', 'dBu', [2, 6, 12], MANUALS.tc4500Dt, [6, 7, 9, 10, 11], {
    maximumInputDbu: 20,
  }),
  'TC-4700': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tc4500, [5, 6, 12], {
    ratedVoltageGainDb: 37.5,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-4700DT': verifiedStage('inputSensitivity', 'dBu', [2, 6, 12], MANUALS.tc4500Dt, [6, 7, 9, 10, 11], {
    maximumInputDbu: 20,
  }),
  'TC-D4200': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcD, [5, 17]),
  'TC-D4350': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcD, [5, 17]),
  'TC-D4500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcD, [5, 17]),
  'TC-X21000': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X21200': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X22000': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2200B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcXB, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2350B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcXB, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2500B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcXB, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2700': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X2700B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcXB, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X41200': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X41500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X4200B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4B, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X4350B': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4B, [5, 11, 20], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X4500': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
  'TC-X4700': verifiedStage('inputSensitivity', 'V', [1, 2], MANUALS.tcX4, [5, 11, 20, 21], {
    defaultValue: 1,
    sourceValueLabels: ['2.2 dBu (1 V)', '8.2 dBu (2 V)'],
  }),
}

module.exports = {
  amplifierInputStages,
}
