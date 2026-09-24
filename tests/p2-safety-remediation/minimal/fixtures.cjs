'use strict'

// These are the facts supplied by each frozen V2.1 utterance.  Keep this map
// explicit: the remediation tests must exercise the page with the original
// facts and a separately confirmed blocker, rather than silently parsing the
// utterance or borrowing a page default.
const CASE_FACTS = Object.freeze({
  'V2-AUD-005': Object.freeze({
    page: 'venue', missing: ['venue.room_length_m'],
    supplied: Object.freeze({
      'venue.room_width_m': 8, 'venue.room_height_m': 4,
      'venue.target_grade': '二级', 'venue.front_wall_layout': '短边前置',
      'venue.first_row_distance_m': 2, 'venue.last_row_distance_m': 10,
      'venue.listening_width_m': 7, 'venue.scene_type': '报告厅',
    }),
    confirm: Object.freeze({ 'venue.room_length_m': 12 }),
  }),
  'V2-AUD-006': Object.freeze({
    page: 'venue', missing: ['venue.room_width_m'],
    supplied: Object.freeze({
      'venue.room_length_m': 12, 'venue.room_height_m': 4,
      'venue.target_grade': '一级', 'venue.front_wall_layout': '短边前置',
      'venue.first_row_distance_m': 3, 'venue.last_row_distance_m': 11,
      'venue.listening_width_m': 8, 'venue.scene_type': '报告厅',
    }),
    confirm: Object.freeze({ 'venue.room_width_m': 8 }),
  }),
  'V2-AUD-007': Object.freeze({
    page: 'venue', missing: ['venue.room_height_m'],
    supplied: Object.freeze({
      'venue.room_length_m': 12, 'venue.room_width_m': 8,
      'venue.target_grade': '二级', 'venue.front_wall_layout': '短边前置',
      'venue.first_row_distance_m': 2, 'venue.last_row_distance_m': 10,
      'venue.listening_width_m': 7, 'venue.scene_type': '报告厅',
    }),
    confirm: Object.freeze({ 'venue.room_height_m': 4 }),
  }),
  'LED-001': Object.freeze({
    page: 'led_screen', missing: ['led_screen.assembly_unit_width_mm', 'led_screen.assembly_unit_height_mm'],
    supplied: Object.freeze({
      'led_screen.wall_width_m': 8, 'led_screen.wall_height_m': 4,
      'led_screen.top_clearance_m': 0.2, 'led_screen.bottom_clearance_m': 0.2,
      'led_screen.border_width_m': 0.05, 'led_screen.aspect_ratio': '16:9',
      'led_screen.assembly_unit': '常规箱体', 'led_screen.nearest_viewing_distance_m': 5,
      'led_screen.pixel_pitch': 2,
    }),
    // The persisted cabinetStandard selection is a historical page state;
    // these two dimensions are the explicit values confirmed in this run.
    persisted: Object.freeze({ unitKey: 'cabinetStandard' }),
    confirm: Object.freeze({ 'led_screen.assembly_unit_width_mm': 640, 'led_screen.assembly_unit_height_mm': 480 }),
  }),
  'LED-003': Object.freeze({
    page: 'led_screen', missing: ['led_screen.assembly_unit_width_mm', 'led_screen.assembly_unit_height_mm'],
    supplied: Object.freeze({
      'led_screen.wall_width_m': 7.2, 'led_screen.wall_height_m': 4.2,
      'led_screen.aspect_ratio': '16:9', 'led_screen.assembly_unit': '模组拼',
      'led_screen.nearest_viewing_distance_m': 4, 'led_screen.pixel_pitch': 1.86,
    }),
    confirm: Object.freeze({ 'led_screen.assembly_unit_width_mm': 320, 'led_screen.assembly_unit_height_mm': 160 }),
  }),
  'LED-005': Object.freeze({
    page: 'led_screen', missing: ['led_screen.assembly_unit_width_mm', 'led_screen.assembly_unit_height_mm', 'led_screen.assembly_unit'],
    supplied: Object.freeze({
      'led_screen.wall_width_m': 7.2, 'led_screen.wall_height_m': 4.05,
      'led_screen.top_clearance_m': 0.2, 'led_screen.bottom_clearance_m': 0.15,
      'led_screen.aspect_ratio': '16:9', 'led_screen.nearest_viewing_distance_m': 4.5,
    }),
    confirm: Object.freeze({
      'led_screen.assembly_unit_width_mm': 640, 'led_screen.assembly_unit_height_mm': 480,
      'led_screen.assembly_unit': '常规箱体',
    }),
  }),
  'LED-006': Object.freeze({
    page: 'led_screen', missing: ['led_screen.assembly_unit_width_mm', 'led_screen.assembly_unit_height_mm', 'led_screen.assembly_unit'],
    supplied: Object.freeze({
      'led_screen.wall_width_m': 6, 'led_screen.wall_height_m': 3,
      'led_screen.top_clearance_m': 0.2, 'led_screen.bottom_clearance_m': 0.15,
      'led_screen.aspect_ratio': '16:9', 'led_screen.nearest_viewing_distance_m': 4,
    }),
    confirm: Object.freeze({
      'led_screen.assembly_unit_width_mm': 640, 'led_screen.assembly_unit_height_mm': 480,
      'led_screen.assembly_unit': '常规箱体',
    }),
  }),
  'DMX-010': Object.freeze({
    page: 'dmx_guide', missing: ['dmx_address.channels_per_fixture'],
    supplied: Object.freeze({ 'dmx_address.fixture_model': 'TL-SL333' }),
    confirm: Object.freeze({ 'dmx_address.channels_per_fixture': 6 }),
  }),
  'CAM-007': Object.freeze({
    page: 'camera', missing: ['camera_fov.vfov_deg'],
    supplied: Object.freeze({
      'camera_fov.hfov_deg': 75, 'camera_fov.target_width_m': 6,
      'camera_fov.area_depth_m': 4, 'camera_fov.subject_height_m': 1.8,
      'camera_fov.height_mode': 'auto', 'camera_fov.margin_percent': 10,
    }),
    uiState: Object.freeze({ sourceMode: 'custom', sceneMode: 'ground' }),
    confirm: Object.freeze({ 'camera_fov.vfov_deg': 24 }),
  }),
})

const CONTROL_FACTS = Object.freeze({
  'DMX-004': Object.freeze({ fixtureName: 'Moving head', fixtureCount: 6, channelCount: 18, startAddress: 'D001', allocationMode: 'manual' }),
  'DMX-006': Object.freeze({ fixtureName: '染色灯', fixtureCount: 4, channelCount: 12, startAddress: 'A01O', allocationMode: 'auto' }),
  'PW-007': Object.freeze({ projectName: '会议室改造', fromDevice: '调音台', toDevice: 'DSP', lengthM: 5 }),
})

function numberIn(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

function assertFrozenFacts(cases) {
  const assert = require('node:assert/strict')
  const frozen = new Map(cases.map((item) => [item.id, item]))
  for (const [id, facts] of Object.entries(CASE_FACTS)) {
    const item = frozen.get(id)
    assert(item, `missing frozen V2.1 case ${id}`)
    const params = item.expected.parameters || {}
    const suppliedKeys = Object.keys(facts.supplied)
    const actualKeys = Object.entries(params).filter(([, value]) => value.user_present).map(([key]) => key)
    for (const key of suppliedKeys) {
      assert(actualKeys.includes(key), `${id}: fixture fact ${key} is not user supplied in frozen case`)
      const expected = facts.supplied[key]
      const source = params[key].value
      if (typeof expected === 'number') {
        const factor = /cm|公分/.test(String(source)) && /_m$/.test(key) ? 0.01 : 1
        assert.strictEqual(numberIn(source) * factor, expected, `${id}: ${key} numeric fact drifted`)
      } else {
        const aliases = {
          auto: ['自动'], ground: ['地面区域'], custom: ['自定义'],
          '16:9': ['16:9'], cabinetStandard: ['常规箱体'], module: ['模组拼'],
        }
        const terms = aliases[expected] || [String(expected)]
        assert(terms.some((term) => String(source).includes(term)), `${id}: ${key} semantic fact drifted`)
      }
    }
    assert.deepStrictEqual(
      facts.missing.slice().sort(),
      Object.entries(params).filter(([, value]) => !value.user_present).map(([key]) => key)
        .filter((key) => facts.missing.includes(key)).sort(),
      `${id}: fixture missing facts drifted`,
    )
  }
  return true
}

module.exports = { CASE_FACTS, CONTROL_FACTS, assertFrozenFacts }
