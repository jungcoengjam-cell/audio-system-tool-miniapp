'use strict'

const camera = require('../../utils/camera-fov')
const { cameras } = require('../../data/cameras')
const { assertCompletePlacementCoverage, evaluatePlacementCoverage } = require('../helpers/camera-coverage-reference')
const { calculateLedScreenPlan, LED_UNIT_SPECS, chooseRecommendedPitch, evaluateViewingDistance } = require('../../utils/led-screen')
const { calculateDmxAddressPlan, MAX_GROUPS, MAX_TOTAL_FIXTURES } = require('../../utils/dmx-address')
const { calculateVenueEstimate } = require('../../utils/venue')
const { calculateDiscussionEstimate } = require('../../utils/venue-discussion')
const { calculatePagNagReview } = require('../../utils/venue-pag-nag')
const { calculatePathDistanceMeters, calculateArrivalDifferenceMs, buildVenueHandoffReview } = require('../../utils/venue-handoff')

const rad = (degrees) => degrees * Math.PI / 180

function group(name, channelCount, fixtureCount, targetUniverse = 'A') {
  return { name, channelCount, fixtureCount, targetUniverse }
}

function finite(value, finiteTree) {
  finiteTree(value)
  return value
}

module.exports = ({ test, assert, close, finiteTree }) => {
  test('camera FOV angle mode and sensor mode agree with independent geometry', () => {
    const angleFov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 30 })
    const sensorFov = camera.resolveCustomFov({ definitionMode: 'sensor', sensorWidth: 36, sensorHeight: 20.25, focalLength: 31.17691453623979 })
    assert(angleFov && sensorFov)
    close(angleFov.horizontalFov, 60)
    close(angleFov.verticalFov, 30)
    close(sensorFov.horizontalFov, 60)
    close(sensorFov.verticalFov, 35.9834, 0.001)
    close(angleFov.diagonalFov, 64.953, 0.001)
  }, { classification: 'implementation bug', basis: 'camera FOV equations: 2 atan(sensor dimension / (2 focal length)) and diagonal from tangent axes' })

  test('camera coverage distance and target-width modes are inverse in metres', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 30 })
    const byDistance = camera.calculateCoverage(fov, { distanceMeters: 10 })
    const byWidth = camera.calculateCoverage(fov, { calculationMode: 'targetWidth', targetWidthMeters: 10 * 2 * Math.tan(rad(30)) })
    finite(byDistance, finiteTree)
    finite(byWidth, finiteTree)
    close(byDistance.coverageWidthMeters, 11.547, 0.005)
    close(byDistance.coverageHeightMeters, 5.359, 0.005)
    close(byWidth.distanceMeters, 10)
    close(byWidth.coverageWidthMeters, byDistance.coverageWidthMeters)
    assert.equal(camera.calculateCoverage(fov, { distanceMeters: 0 }), null)
    assert.equal(camera.calculateCoverage(fov, { calculationMode: 'targetWidth', targetWidthMeters: -1 }), null)
  }, { classification: 'implementation bug', basis: 'camera coverage uses width/height = 2 × distance × tan(FOV/2)' })

  test('camera plane and ground placement obey independent horizontal lower bounds and margin scaling', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 })
    const planeOptions = { sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, marginRatio: 0, heightMode: 'auto' }
    const planeMarginOptions = { ...planeOptions, marginRatio: 0.2 }
    const groundOptions = { sceneMode: 'ground', widthMeters: 4, depthMeters: 3, subjectHeightMeters: 1.7, marginRatio: 0, heightMode: 'auto' }
    const plane = camera.calculateVerticalPlanePlacement(fov, planeOptions)
    const planeWithMargin = camera.calculateVerticalPlanePlacement(fov, planeMarginOptions)
    const ground = camera.calculateGroundAreaPlacement(fov, groundOptions)
    ;[plane, planeWithMargin, ground].forEach((result) => finite(result, finiteTree))
    assertCompletePlacementCoverage(assert, finiteTree, fov, planeOptions, plane, 'plane auto, zero margin')
    assertCompletePlacementCoverage(assert, finiteTree, fov, planeMarginOptions, planeWithMargin, 'plane auto, 20% margin')
    assertCompletePlacementCoverage(assert, finiteTree, fov, groundOptions, ground, 'ground auto, zero margin')
    close(plane.horizontalMinimumDistanceMeters, 4 / (2 * Math.tan(rad(30))), 0.01)
    close(planeWithMargin.horizontalMinimumDistanceMeters / plane.horizontalMinimumDistanceMeters, 1.2, 0.003)
    assert(plane.distanceMeters + 1e-9 >= plane.horizontalMinimumDistanceMeters)
    assert(plane.distanceMeters + 1e-9 >= plane.verticalMinimumDistanceMeters)
    assert(ground.cameraSetbackMeters + 1e-9 >= ground.effectiveNearDistanceMeters)
    assert.equal(plane.cameraHeightMeters, 2)
    assert.equal(ground.cameraHeightMeters, 2.2)
    assert.equal(camera.calculateVerticalPlanePlacement(fov, { widthMeters: 1, heightMeters: 1, bottomHeightMeters: -0.01 }), null)
    assert.equal(camera.calculateGroundAreaPlacement(fov, { widthMeters: 1, depthMeters: 0, subjectHeightMeters: 1 }), null)
  }, { classification: 'implementation bug', basis: 'camera plane/ground geometry and explicit 0.2 margin input; assertions use unrounded trigonometric reference' })

  test('camera vertical-plane high fixed camera selects the first feasible far branch when width start is forbidden', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 10 })
    const options = {
      sceneMode: 'plane', widthMeters: 10, heightMeters: 3, bottomHeightMeters: 0,
      heightMode: 'fixed', cameraHeightMeters: 10, marginRatio: 0,
    }
    const result = camera.calculateVerticalPlanePlacement(fov, options)
    const horizontalStart = options.widthMeters / (2 * Math.tan(rad(fov.horizontalFov / 2)))
    const atHorizontalStart = evaluatePlacementCoverage(fov, options, horizontalStart)
    assert(atHorizontalStart.horizontalCovered)
    assert(!atHorizontalStart.verticalCovered,
      'the horizontal width boundary is inside the vertical forbidden zone for the high fixed camera')
    assertCompletePlacementCoverage(assert, finiteTree, fov, options, result, 'high fixed plane')

    const rawDistance = result.calculationDistanceMeters
    assert(rawDistance > horizontalStart, 'the complete solution must move beyond the forbidden horizontal start')
    assert(rawDistance > 10, 'the first feasible branch after the horizontal start is the far branch')
    const immediatelyBefore = evaluatePlacementCoverage(fov, options, rawDistance - 1e-6)
    assert(!immediatelyBefore.verticalCovered,
      'a point immediately before the returned far boundary must remain vertically infeasible')
    close(result.distanceMeters, 10.05, 1e-12, 'case #9 should display the rounded calculation distance as 10.05 m')
    const displayedCoverage = evaluatePlacementCoverage(fov, options, result.distanceMeters)
    assert(displayedCoverage.horizontalCovered && displayedCoverage.verticalCovered,
      'the displayed 10.05 m distance must also cover both axes for case #9')

    let previousDistance = horizontalStart
    let firstFeasibleDistance = null
    for (let sample = 1; sample <= 2000; sample += 1) {
      const currentDistance = horizontalStart + sample * 0.01
      const coverage = evaluatePlacementCoverage(fov, options, currentDistance)
      if (coverage.horizontalCovered && coverage.verticalCovered) {
        firstFeasibleDistance = currentDistance
        break
      }
      previousDistance = currentDistance
    }
    assert(firstFeasibleDistance, 'independent 1 cm scan should find the far feasible branch')
    let lower = previousDistance
    let upper = firstFeasibleDistance
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (lower + upper) / 2
      const coverage = evaluatePlacementCoverage(fov, options, middle)
      if (coverage.horizontalCovered && coverage.verticalCovered) upper = middle
      else lower = middle
    }
    close(rawDistance, upper, 1e-7, 'solver result should match the independently derived first far-branch boundary')
  }, { classification: 'implementation bug', basis: 'Independent atan2 envelope and tan width boundary; both axes must pass at the raw solution and the near-side horizontal start is vertically forbidden.', issue: 'CAMERA-HIGH-FIXED-HEIGHT' })

  test('camera full placements cover both axes across a deterministic geometry and optics matrix', () => {
    const angleFov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 })
    const narrowFov = camera.resolveCustomFov({ horizontalFov: 90, verticalFov: 0.5 })
    const sensorFov = camera.resolveCustomFov({
      definitionMode: 'sensor', sensorWidth: 36, sensorHeight: 20.25, focalLength: 31.17691453623979,
    })
    const cases = [
      {
        name: 'plane auto at target center, horizontal boundary starts covered', fov: angleFov,
        options: { sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, heightMode: 'auto', marginRatio: 0 },
      },
      {
        name: 'plane fixed at target center, vertical axis dominates', fov: camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 20 }),
        options: { sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, heightMode: 'fixed', cameraHeightMeters: 2, marginRatio: 0.1 },
      },
      {
        name: 'plane fixed above target, near branch begins covered', fov: camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 10 }),
        options: { sceneMode: 'plane', widthMeters: 2, heightMeters: 3, bottomHeightMeters: 0, heightMode: 'fixed', cameraHeightMeters: 10, marginRatio: 0 },
      },
      {
        name: 'plane fixed below target with existing margin', fov: camera.resolveCustomFov({ horizontalFov: 65, verticalFov: 30 }),
        options: { sceneMode: 'plane', widthMeters: 2, heightMeters: 2, bottomHeightMeters: 1, heightMode: 'fixed', cameraHeightMeters: 0.5, marginRatio: 0.1 },
      },
      {
        name: 'plane fixed above target with extremely narrow vertical FOV', fov: narrowFov,
        options: { sceneMode: 'plane', widthMeters: 0.5, heightMeters: 1, bottomHeightMeters: 2, heightMode: 'fixed', cameraHeightMeters: 8, marginRatio: 0 },
      },
      {
        name: 'ground auto with zero margin and horizontal axis dominant', fov: camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 60 }),
        options: { sceneMode: 'ground', widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginRatio: 0 },
      },
      {
        name: 'ground fixed above subject with vertical axis dominant', fov: camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 12 }),
        options: { sceneMode: 'ground', widthMeters: 4, depthMeters: 5, subjectHeightMeters: 1.8, heightMode: 'fixed', cameraHeightMeters: 3, marginRatio: 0.1 },
      },
      {
        name: 'ground fixed inside subject height with existing margin', fov: camera.resolveCustomFov({ horizontalFov: 70, verticalFov: 20 }),
        options: { sceneMode: 'ground', widthMeters: 5, depthMeters: 3, subjectHeightMeters: 1.8, heightMode: 'fixed', cameraHeightMeters: 1, marginRatio: 0.1 },
      },
      {
        name: 'ground auto from sensor-derived FOV', fov: sensorFov,
        options: { sceneMode: 'ground', widthMeters: 3, depthMeters: 2, subjectHeightMeters: 1.6, heightMode: 'auto', marginRatio: 0.05 },
      },
      {
        name: 'plane fixed below target from sensor-derived FOV', fov: sensorFov,
        options: { sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, heightMode: 'fixed', cameraHeightMeters: 0.75, marginRatio: 0.05 },
      },
    ]

    let checkedPlacements = 0
    let horizontalStartCoveredCount = 0
    let horizontalStartForbiddenCount = 0
    for (const { name, fov, options } of cases) {
      const placement = options.sceneMode === 'plane'
        ? camera.calculateVerticalPlanePlacement(fov, options)
        : camera.calculateGroundAreaPlacement(fov, options)
      assertCompletePlacementCoverage(assert, finiteTree, fov, options, placement, name)
      checkedPlacements += 1
      const horizontalStart = options.widthMeters * (1 + options.marginRatio)
        / (2 * Math.tan(rad(fov.horizontalFov / 2)))
      const startCoverage = evaluatePlacementCoverage(fov, options, horizontalStart)
      if (startCoverage.verticalCovered) {
        horizontalStartCoveredCount += 1
        close(placement.calculationDistanceMeters, horizontalStart, 1e-8,
          `${name}: solver should retain the horizontal start when both axes already pass`)
      } else {
        horizontalStartForbiddenCount += 1
        assert(placement.calculationDistanceMeters > horizontalStart,
          `${name}: solver should move beyond a horizontally valid but vertically forbidden start`)
      }
    }
    assert.strictEqual(checkedPlacements, cases.length, 'all explicitly valid matrix cases must return and pass the independent oracle')
    assert(horizontalStartCoveredCount > 0, 'matrix must cover the horizontal-start-already-feasible near branch')
    assert(horizontalStartForbiddenCount > 0, 'matrix must cover a vertical-forbidden horizontal start and a later feasible branch')

    let libraryPlacements = 0
    const libraryCases = []
    for (const cameraModel of cameras) {
      for (let viewIndex = 0; viewIndex < cameraModel.views.length; viewIndex += 1) {
        for (const endpoint of ['wide', 'tele']) {
          const fov = camera.resolveLibraryFov(cameraModel, viewIndex, endpoint)
          if (fov) libraryCases.push({ cameraModel, viewIndex, endpoint, fov })
        }
      }
    }
    for (const { cameraModel, viewIndex, endpoint, fov } of libraryCases) {
      for (const sceneMode of ['plane', 'ground']) {
        for (const heightMode of ['auto', 'fixed']) {
          const options = sceneMode === 'plane'
            ? { sceneMode, widthMeters: 6, heightMeters: 2.5, bottomHeightMeters: 0.8, heightMode, cameraHeightMeters: 2.3, marginRatio: 0.1 }
            : { sceneMode, widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode, cameraHeightMeters: 2.3, marginRatio: 0.1 }
          const result = sceneMode === 'plane'
            ? camera.calculateVerticalPlanePlacement(fov, options)
            : camera.calculateGroundAreaPlacement(fov, options)
          assertCompletePlacementCoverage(
            assert, finiteTree, fov, options, result,
            `${cameraModel.model}/${viewIndex}/${endpoint}/${sceneMode}/${heightMode}`,
          )
          libraryPlacements += 1
        }
      }
    }
    assert(libraryCases.length > 0 && libraryPlacements > 0, 'library matrix should include complete FOV options')
    assert.strictEqual(libraryPlacements, libraryCases.length * 4,
      'every full library FOV option must be checked in plane/ground and auto/fixed combinations')
    assert.strictEqual(checkedPlacements, cases.length, 'matrix case count must remain deterministic')
  }, { classification: 'implementation bug', basis: 'A deterministic matrix checks raw two-axis coverage for plane/ground, auto/fixed, high/center/low cameras, zero/existing margins, angle/sensor optics, narrow vertical FOV, and every complete catalog FOV in both scene and height modes.' })

  test('horizontal-only camera placements omit vertical verification and retain finite horizontal geometry', () => {
    const result = camera.calculateHorizontalOnlyPlacement({ horizontalFov: 90 }, {
      sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1,
      marginRatio: 0, heightMode: 'fixed', cameraHeightMeters: 3,
    })
    finite(result, finiteTree)
    close(result.horizontalMinimumDistanceMeters, 2)
    close(result.frameWidthMeters, 4)
    assert.equal(result.horizontalOnly, true)
    assert.equal(result.verticalCoverageVerified, false)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'coverageVerified'), false,
      'horizontal-only placement must not claim full two-axis verification')
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'calculationDistanceMeters'), false,
      'horizontal-only placement must not expose a full-placement calculation distance')
    assert.equal(camera.calculateHorizontalOnlyPlacement({ horizontalFov: 0 }, { widthMeters: 4 }), null)
  }, { classification: 'implementation bug', basis: 'horizontal-only placement contract: use horizontal FOV and explicitly leave vertical coverage unverified' })

  test('camera Infinity target dimensions are rejected or yield finite outputs', () => {
    const result = camera.calculateVerticalPlanePlacement(
      camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 }),
      { widthMeters: Infinity, heightMeters: 2, bottomHeightMeters: 1, marginRatio: 0 },
    )
    if (result) finiteTree(result)
    assert.equal(result, null)
  }, { classification: 'implementation bug', basis: 'spatial calculations must reject nonfinite physical dimensions; reproducible current case: plane widthMeters=Infinity', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('camera sensor mode rejects nonfinite physical dimensions and keeps finite optics', () => {
    const invalidValues = [NaN, Infinity, -Infinity, 'Infinity', '-Infinity', 'not-a-number', undefined]
    for (const field of ['sensorWidth', 'sensorHeight', 'focalLength']) {
      for (const value of invalidValues) {
        const result = camera.resolveCustomFov({
          definitionMode: 'sensor', sensorWidth: 36, sensorHeight: 24, focalLength: 50,
          [field]: value,
        })
        assert.equal(result, null, `${field}=${value} must be rejected`)
      }
    }
    const finiteFov = camera.resolveCustomFov({ definitionMode: 'sensor', sensorWidth: 36, sensorHeight: 24, focalLength: 50 })
    assert(finiteFov)
    close(finiteFov.horizontalFov, 39.5978, 0.001)
    close(finiteFov.verticalFov, 26.9915, 0.001)
  }, { classification: 'implementation bug', basis: 'sensor FOV inputs are physical dimensions and must be finite positive numbers', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('camera coverage rejects nonfinite selected distance and target width', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 30 })
    for (const value of [NaN, Infinity, -Infinity, 'Infinity', '-Infinity', 'not-a-number', undefined]) {
      assert.equal(camera.calculateCoverage(fov, { distanceMeters: value }), null, `distanceMeters=${value} must be rejected`)
      assert.equal(camera.calculateCoverage(fov, { calculationMode: 'targetWidth', targetWidthMeters: value }), null, `targetWidthMeters=${value} must be rejected`)
    }
    const targetWidthResult = camera.calculateCoverage(fov, {
      calculationMode: 'targetWidth', targetWidthMeters: 10, distanceMeters: NaN,
    })
    finite(targetWidthResult, finiteTree)
    close(targetWidthResult.coverageWidthMeters, 10)
  }, { classification: 'implementation bug', basis: 'coverage must reject nonfinite selected physical inputs while retaining mode-specific ignored inputs', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('camera ground placement rejects nonfinite dimensions and fixed camera height', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 })
    const base = { widthMeters: 4, depthMeters: 3, subjectHeightMeters: 1.7, heightMode: 'fixed', cameraHeightMeters: 2.5 }
    for (const field of ['widthMeters', 'depthMeters', 'subjectHeightMeters', 'cameraHeightMeters']) {
      for (const value of [NaN, Infinity, -Infinity, 'Infinity', '-Infinity', 'not-a-number', undefined]) {
        const result = camera.calculateGroundAreaPlacement(fov, { ...base, [field]: value })
        assert.equal(result, null, `${field}=${value} must be rejected`)
      }
    }
    const validOptions = {
      sceneMode: 'ground', widthMeters: 4, depthMeters: 3, subjectHeightMeters: 1.7,
      heightMode: 'auto', cameraHeightMeters: Infinity, marginRatio: 0.1,
    }
    const valid = camera.calculateGroundAreaPlacement(fov, validOptions)
    finite(valid, finiteTree)
    assertCompletePlacementCoverage(assert, finiteTree, fov, validOptions, valid, 'ground auto ignoring unused Infinity camera height')
    close(valid.cameraHeightMeters, 2.2)
  }, { classification: 'implementation bug', basis: 'ground placement dimensions and selected fixed camera height must be finite; auto mode ignores supplied camera height', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('camera vertical plane rejects nonfinite dimensions while accepting a zero bottom height', () => {
    const fov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 })
    const base = { widthMeters: 4, heightMeters: 2, bottomHeightMeters: 0, heightMode: 'fixed', cameraHeightMeters: 3 }
    for (const field of ['widthMeters', 'heightMeters', 'bottomHeightMeters', 'cameraHeightMeters']) {
      for (const value of [NaN, Infinity, -Infinity, 'Infinity', '-Infinity', 'not-a-number', undefined]) {
        const result = camera.calculateVerticalPlanePlacement(fov, { ...base, [field]: value })
        assert.equal(result, null, `${field}=${value} must be rejected`)
      }
    }
    const validOptions = {
      sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 0,
      heightMode: 'auto', cameraHeightMeters: 3, marginRatio: 0.1,
    }
    const valid = camera.calculateVerticalPlanePlacement(fov, validOptions)
    finite(valid, finiteTree)
    assertCompletePlacementCoverage(assert, finiteTree, fov, validOptions, valid, 'plane auto with zero bottom height')
    assert.equal(valid.bottomHeightMeters, 0)
    close(valid.cameraHeightMeters, 1)
  }, { classification: 'implementation bug', basis: 'plane dimensions must be finite, bottom height remains nonnegative so zero is valid, and fixed camera height must be finite', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('camera full placements reject invalid two-axis FOV and numerical overflow', () => {
    const planeOptions = { sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, marginRatio: 0, heightMode: 'auto' }
    const groundOptions = { sceneMode: 'ground', widthMeters: 4, depthMeters: 3, subjectHeightMeters: 1.7, marginRatio: 0, heightMode: 'auto' }
    for (const fov of [
      null,
      { horizontalFov: 0, verticalFov: 30 },
      { horizontalFov: 60, verticalFov: 0 },
      { horizontalFov: 179, verticalFov: 30 },
      { horizontalFov: 400, verticalFov: 30 },
      { horizontalFov: 60, verticalFov: 179 },
      { horizontalFov: NaN, verticalFov: 30 },
      { horizontalFov: 60, verticalFov: Infinity },
    ]) {
      assert.equal(camera.calculateVerticalPlanePlacement(fov, planeOptions), null,
        `plane placement must reject invalid full FOV ${String(fov && fov.horizontalFov)}×${String(fov && fov.verticalFov)}`)
      assert.equal(camera.calculateGroundAreaPlacement(fov, groundOptions), null,
        `ground placement must reject invalid full FOV ${String(fov && fov.horizontalFov)}×${String(fov && fov.verticalFov)}`)
    }
    const validFov = camera.resolveCustomFov({ horizontalFov: 60, verticalFov: 40 })
    const overflowPlane = camera.calculateVerticalPlanePlacement(validFov,
      { ...planeOptions, widthMeters: Number.MAX_VALUE, marginRatio: 0.5 })
    const overflowGround = camera.calculateGroundAreaPlacement(validFov,
      { ...groundOptions, widthMeters: Number.MAX_VALUE, marginRatio: 0.5 })
    const overflowGroundDepth = camera.calculateGroundAreaPlacement(validFov,
      { ...groundOptions, depthMeters: Number.MAX_VALUE, marginRatio: 0.5 })
    assert.equal(overflowPlane, null, 'an overflowed effective plane width must not return a placement')
    assert.equal(overflowGround, null, 'an overflowed effective ground width must not return a placement')
    assert.equal(overflowGroundDepth, null,
      'an overflowed effective depth or camera setback must fail the final geometry guard')
    assert.equal(camera.calculateVerticalPlanePlacement(
      { horizontalFov: 1e-320, verticalFov: 30 }, planeOptions,
    ), null, 'a numerically unusable horizontal angle must not produce a placement')
  }, { classification: 'implementation bug', basis: 'A complete placement requires valid positive horizontal and vertical angles and finite derived boundaries; invalid or overflowed geometry must yield null rather than a verified result.' })

  test('horizontal-only camera placement rejects nonfinite fields for both scene types', () => {
    const fov = { horizontalFov: 90 }
    const cases = [
      { sceneMode: 'plane', base: { widthMeters: 4, heightMeters: 2, bottomHeightMeters: 1, heightMode: 'fixed', cameraHeightMeters: 3 }, fields: ['widthMeters', 'heightMeters', 'bottomHeightMeters', 'cameraHeightMeters'] },
      { sceneMode: 'ground', base: { widthMeters: 4, depthMeters: 3, subjectHeightMeters: 1.7, heightMode: 'fixed', cameraHeightMeters: 3 }, fields: ['widthMeters', 'depthMeters', 'subjectHeightMeters', 'cameraHeightMeters'] },
    ]
    for (const { sceneMode, base, fields } of cases) {
      for (const field of fields) {
        for (const value of [NaN, Infinity, -Infinity, 'Infinity', '-Infinity', 'not-a-number', undefined]) {
          const result = camera.calculateHorizontalOnlyPlacement(fov, { ...base, sceneMode, [field]: value })
          assert.equal(result, null, `${sceneMode}.${field}=${value} must be rejected`)
        }
      }
    }
    const validPlane = camera.calculateHorizontalOnlyPlacement(fov, {
      sceneMode: 'plane', widthMeters: 4, heightMeters: 2, bottomHeightMeters: 0,
      heightMode: 'auto', cameraHeightMeters: NaN,
    })
    finite(validPlane, finiteTree)
    assert.equal(validPlane.bottomHeightMeters, 0)
  }, { classification: 'implementation bug', basis: 'horizontal-only placement validates all used physical dimensions and selected camera height; auto mode ignores cameraHeightMeters', issue: 'CAMERA-NONFINITE-DIMENSION' })

  test('LED wall plan converts module dimensions, metres and pixel pitch consistently', () => {
    const result = calculateLedScreenPlan({
      wallWidthMeters: 6, wallHeightMeters: 3, topReserveMeters: 0.2,
      bottomReserveMeters: 0.2, frameWidthMeters: 0.05, viewingDistanceMeters: 3,
      aspectRatioKey: '16:9', unitKey: 'module', pixelPitch: '2',
    })
    finite(result, finiteTree)
    const spec = LED_UNIT_SPECS.module
    close(result.screenWidthMeters, result.columns * spec.widthMm / 1000, 0.001)
    close(result.screenHeightMeters, result.rows * spec.heightMm / 1000, 0.001)
    close(result.installedWidthMeters, result.screenWidthMeters + 0.1, 0.001)
    close(result.estimatedPixelWidth, Math.round(result.screenWidthMeters * 1000 / 2))
    close(result.minimumDistanceMeters, 2)
    assert.equal(result.pixelPitch, 2)
    assert.equal(calculateLedScreenPlan({ wallWidthMeters: '', wallHeightMeters: 3 }).error !== undefined, true)
  }, { classification: 'implementation bug', basis: 'LED unit specs are millimetres; plan fields are metres and pixel counts are millimetres divided by pitch in millimetres' })

  test('LED recommended pitch boundaries use the documented 1.7 multiplier and viewing thresholds', () => {
    ;[1.25, 1.53, 1.86, 2].forEach((pitch) => {
      close(chooseRecommendedPitch(pitch * 1.7), pitch)
      close(chooseRecommendedPitch(pitch * 1.7 - 1e-8), pitch === 1.25 ? 1.25 : ([1.25, 1.53, 1.86, 2].filter((candidate) => candidate * 1.7 <= pitch * 1.7 - 1e-8).pop() || 1.25))
    })
    assert.equal(evaluateViewingDistance(1.99, 2).statusKey, 'avoid')
    assert.equal(evaluateViewingDistance(2, 2).statusKey, 'near')
    assert.equal(evaluateViewingDistance(3.4, 2).statusKey, 'fit')
    assert.equal(evaluateViewingDistance(6.01, 2).statusKey, 'surplus')
  }, { classification: 'implementation bug', basis: 'LED viewing policy: minimum distance=pitch; comfortable range=1.7× to 3× pitch; recommended pitch uses 1.7× boundary' })

  test('DMX automatic and manual allocation preserve fixture boundaries and channel totals', () => {
    const automatic = calculateDmxAddressPlan({ startAddress: 500, groups: [group('12ch', 12, 2), group('4ch', 4, 1)], allocationMode: 'auto' })
    const manual = calculateDmxAddressPlan({ startAddress: 1, groups: [group('12ch', 12, 2), group('4ch', 4, 1)], allocationMode: 'manual' })
    ;[automatic, manual].forEach((result) => finite(result, finiteTree))
    assert.deepEqual(automatic.fixtures.map(({ universe, startAddress, endAddress }) => [universe, startAddress, endAddress]), [[1, 500, 511], [2, 1, 12], [2, 13, 16]])
    assert.deepEqual(manual.fixtures.map(({ universe, startAddress, endAddress }) => [universe, startAddress, endAddress]), [[1, 1, 12], [1, 13, 24], [1, 25, 28]])
    assert.equal(automatic.totalChannels, 28)
    assert.equal(manual.totalChannels, 28)
    const manualOverflow = calculateDmxAddressPlan({ startAddress: 500, allocationMode: 'manual', groups: [group('cannot split', 12, 2)] })
    assert(manualOverflow.error)
  }, { classification: 'implementation bug', basis: 'DMX slots are inclusive, one fixture cannot cross a universe boundary, and auto allocation resumes at address 1' })

  test('DMX caps accept each exact limit and reject the next unit', () => {
    const maxGroups = Array.from({ length: MAX_GROUPS }, (_, index) => group(`g${index}`, 1, 1))
    assert.equal(calculateDmxAddressPlan({ startAddress: 1, groups: maxGroups }).error, undefined)
    assert(calculateDmxAddressPlan({ startAddress: 1, groups: maxGroups.concat(group('extra', 1, 1)) }).error)
    assert.equal(calculateDmxAddressPlan({ startAddress: 1, groups: [group('per-group', 1, 200)] }).totalFixtures, 200)
    assert(calculateDmxAddressPlan({ startAddress: 1, groups: [group('per-group', 1, 201)] }).error)
    const exactly500 = calculateDmxAddressPlan({ startAddress: 1, groups: [group('first', 1, 200), group('second', 1, 200), group('third', 1, 100)] })
    assert.equal(exactly500.error, undefined)
    assert.equal(exactly500.totalFixtures, MAX_TOTAL_FIXTURES)
    assert(calculateDmxAddressPlan({ startAddress: 1, groups: [group('over-total-a', 1, 200), group('over-total-b', 1, 200), group('over-total-c', 1, 101)] }).error)
    const dmxDomainEdge = calculateDmxAddressPlan({ startAddress: 1, groups: [group('512ch', 512, 4)] })
    assert.equal(dmxDomainEdge.error, undefined)
    assert.equal(dmxDomainEdge.fixtures[3].universeLabel, 'D')
    assert.equal(dmxDomainEdge.fixtures[3].endAddress, 512)
    assert(calculateDmxAddressPlan({ startAddress: 1, groups: [group('past D', 512, 5)] }).error)
    assert(calculateDmxAddressPlan({ startAddress: 1, groups: [group('overwide fixture', 513, 1)] }).error)
    const manualAllDomains = calculateDmxAddressPlan({
      startAddress: 512,
      allocationMode: 'manual',
      groups: ['A', 'B', 'C', 'D'].map((domain) => group(`${domain} full`, domain === 'A' ? 1 : 512, 1, domain)),
    })
    finite(manualAllDomains, finiteTree)
    assert.deepEqual(manualAllDomains.fixtures.map(({ universeLabel, startAddress, endAddress }) => [universeLabel, startAddress, endAddress]), [
      ['A', 512, 512], ['B', 1, 512], ['C', 1, 512], ['D', 1, 512],
    ])
  }, { classification: 'implementation bug', basis: 'DMX limits exported by utils/dmx-address.js: 20 groups, 200 per group, 500 total and 512 channels per universe' })

  test('venue estimate and discussion estimate produce finite coordinates inside the room', () => {
    const venue = calculateVenueEstimate({ lengthMeters: 12, widthMeters: 8, heightMeters: 4, firstListeningDistanceMeters: 3, lastListeningDistanceMeters: 11, listeningWidthMeters: 7, layout: 'short', standardClassKey: 'conference', gradeKey: 'II' })
    const discussion = calculateDiscussionEstimate({ lengthMeters: 10, widthMeters: 8, heightMeters: 3, tableShape: 'round', tableDiameterMeters: 3, participantCount: 12, audioMode: 'voiceLift', installationCondition: 'flat', standardClassKey: 'conference', gradeKey: 'II' })
    finite(venue, finiteTree)
    finite(discussion, finiteTree)
    assert.equal(venue.error, undefined)
    assert.equal(discussion.error, undefined)
    assert(venue.mainSpeakerPositions.every((speaker) => speaker.widthMeters >= 0 && speaker.widthMeters <= 8 && speaker.depthMeters >= 0 && speaker.depthMeters <= 12))
    assert(discussion.speakerPositions.every((speaker) => speaker.widthMeters >= 0 && speaker.widthMeters <= 8 && speaker.depthMeters >= 0 && speaker.depthMeters <= 10))
    assert(calculateVenueEstimate({ lengthMeters: Infinity, widthMeters: 8, heightMeters: 4 }).error)
    assert(calculateDiscussionEstimate({ lengthMeters: 10, widthMeters: 8, heightMeters: 3, participantCount: 12, tableShape: 'round', tableDiameterMeters: 3 }).speakerPositions)
  }, { classification: 'implementation bug', basis: 'venue geometry outputs speaker coordinates in metres bounded by room width and length' })

  test('handoff path length and arrival time use three-dimensional metres and seconds-to-milliseconds conversion', () => {
    close(calculatePathDistanceMeters({ point: { widthMeters: 3, depthMeters: 4 }, source: { widthMeters: 0, depthMeters: 0 }, speakerCenterHeightMeters: 4, earHeightMeters: 1 }), Math.sqrt(34))
    close(calculateArrivalDifferenceMs({ upstreamDistanceMeters: 10, fillDistanceMeters: 5, speedOfSoundMetersPerSecond: 343 }), 5000 / 343)
    close(calculateArrivalDifferenceMs({ upstreamDistanceMeters: 5, fillDistanceMeters: 10, speedOfSoundMetersPerSecond: 343 }), -5000 / 343)
    assert.equal(calculatePathDistanceMeters({ point: {}, source: {} }), null)
    assert.equal(calculateArrivalDifferenceMs({ upstreamDistanceMeters: -1, fillDistanceMeters: 1 }), null)
  }, { classification: 'implementation bug', basis: 'Euclidean path in metres; arrival delta is distance difference divided by 343 m/s and multiplied by 1000 ms/s' })

  test('venue handoff review marks a known common coverage point and keeps finite timing', () => {
    const result = buildVenueHandoffReview({
      speakerCenterHeightMeters: 2.5, earHeightMeters: 1.2, listeningSideMarginMeters: 0,
      listeningWidthMeters: 4,
      sources: [
        { id: 'main', label: 'main', type: 'main', widthMeters: 2, depthMeters: 0, aimDepthMeters: 0, coverageDeg: 120, verticalCoverageDeg: 120, aimYawDeg: 0, aimDownDeg: 0 },
        { id: 'fill', label: 'fill', type: 'fill', widthMeters: 2, depthMeters: 4, aimDepthMeters: 6, coverageDeg: 120, verticalCoverageDeg: 120, aimYawDeg: 0, aimDownDeg: 0 },
      ],
    })
    finite(result, finiteTree)
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].totalPointCount, 3)
    assert.equal(result.groups[0].commonPointCount, 3)
    assert(result.groups[0].points.every((point) => Number.isFinite(point.arrivalDifferenceMsRaw)))
  }, { classification: 'implementation bug', basis: 'handoff review samples the common listening region and reports finite acoustic arrival differences' })

  test('PAG/NAG single-speaker reference matches independent logarithmic arithmetic and scales by microphone count', () => {
    const input = { ds: 0.2, d0: 10, dn: 1, d1: 7.9075912893876845, d2: 2.3853720883753127, nom: 1 }
    const result = calculatePagNagReview(input)
    finite(result, finiteTree)
    close(result.pagDb, 20 * Math.log10((input.d1 * input.d0) / (input.d2 * input.ds)) - 6)
    close(result.nagDb, 20 * Math.log10(input.d0 / input.dn))
    close(result.marginDb, result.pagDb - result.nagDb)
    const twoMics = calculatePagNagReview({ ...input, nom: 2 })
    close(result.pagDb - twoMics.pagDb, 10 * Math.log10(2))
    close(result.nagDb, twoMics.nagDb)
    assert.equal(calculatePagNagReview({ ...input, ds: 0 }).field, 'ds')
  }, { classification: 'implementation bug', basis: 'PAG=20log10(d1*d0/(d2*ds))-10log10(NOM)-6; NAG=20log10(d0/dn)' })

  test('PAG/NAG multiple-speaker geometry and distance scaling preserve finite acoustic result', () => {
    const input = { speakerMode: 'multiple', ds: 1, d0: 10, dn: 4, d1: 5, d2: 5, nom: 2 }
    const result = calculatePagNagReview(input)
    finite(result, finiteTree)
    assert.equal(result.basis, 'omnidirectional-multiple-speakers')
    const scaled = calculatePagNagReview({ ...input, ds: 10, d0: 100, dn: 40, d1: 50, d2: 50 })
    finite(scaled, finiteTree)
    close(scaled.pagDb, result.pagDb)
    close(scaled.nagDb, result.nagDb)
    assert.equal(calculatePagNagReview({ ...input, speakerMode: 'multiple', d2: 100 }).errorKind, 'inconsistent')
  }, { classification: 'implementation bug', basis: 'PAG/NAG logarithmic distance ratios are invariant under common distance scaling; multiple-speaker geometry has its own consistency rule' })
}
