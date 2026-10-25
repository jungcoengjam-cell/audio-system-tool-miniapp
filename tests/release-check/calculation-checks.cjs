function createCalculationChecks(context) {
  const {
    assert,
    buildCatalogCategories,
    buildCatalogOptions,
    filterCatalogItems,
    findCatalogModelIndex,
    calculateLedScreenPlan,
    calculateGainStructure,
    APP_VERSION,
    PRODUCT_COUNTS,
    PRODUCT_DATA_DATE,
    amplifierInputStages,
    amplifiers,
    cameras,
    dmxFixtures,
    stageLightingProducts,
    knowledgeItems,
    findKnowledgeById,
    speakerSpecifications,
    speakers,
    buildProductComparison,
    filterProducts,
    getCalculableCameraViews,
    getCategories,
    getHorizontalCameraViews,
    getProductDetail,
    getProductList,
    resolveLibraryFov,
    PACKAGE_BUDGETS,
    collectMediaFiles,
    formatKiB,
    getRegisteredPagePaths,
    assertUnique,
    findByModel,
    calculateConstantVoltageCable,
    calculateProfessionalSpeakerCable,
    calculateCoverage,
    calculateGroundAreaPlacement,
    calculateHorizontalOnlyPlacement,
    calculateVerticalPlanePlacement,
    calculateLimiter,
    calculateSpeakerSpl,
    getCameraMountLabel,
    getCameraMountType,
    resolveCustomFov,
    resolveLibraryOptics,
    path,
    fs,
    root,
  } = context

  function checkCatalogSelector() {
    const options = buildCatalogOptions([
      { model: 'TC-2350B', sensitivityDb: 91 },
      { model: 'TS-803C', sensitivityDb: 95 },
      { model: 'TC-2500B', sensitivityDb: 92 },
    ], (item) => ({ sensitivityDb: item.sensitivityDb }))
    const categories = buildCatalogCategories(options)

    assert.deepStrictEqual(categories.map((item) => item.label), ['全部', 'TC系列', 'TS系列'])
    assert.deepStrictEqual(filterCatalogItems(options, categories, '2350', 0).map((item) => item.model), ['TC-2350B'])
    assert.deepStrictEqual(filterCatalogItems(options, categories, '', 1).map((item) => item.model), ['TC-2350B', 'TC-2500B'])
    assert.strictEqual(findCatalogModelIndex(options, 'TS-803C'), 1)
    assert.strictEqual(findCatalogModelIndex(options, 'missing', 2), 2)
    assert.strictEqual(options[1].sensitivityDb, 95)
  }

  function checkLedScreenPlan() {
    const modulePlan = calculateLedScreenPlan({
      wallWidthMeters: 6,
      wallHeightMeters: 3,
      topReserveMeters: 0.2,
      bottomReserveMeters: 0.2,
      viewingDistanceMeters: 3,
      unitKey: 'module',
      pixelPitch: 'recommended',
    })
    assert.strictEqual(modulePlan.error, undefined)
    assert.strictEqual(modulePlan.pixelPitch, 1.53)
    assert.strictEqual(modulePlan.screenWidthMeters * 1000 % 320, 0)
    assert.strictEqual(modulePlan.screenHeightMeters * 1000 % 160, 0)
    assert.strictEqual(modulePlan.totalUnits, modulePlan.columns * modulePlan.rows)
    assert(modulePlan.screenWidthMeters <= 6)
    assert.strictEqual(modulePlan.frameWidthCentimeters, 5)
    assert.strictEqual(modulePlan.columns, 14)
    assert.strictEqual(modulePlan.rows, 15)
    assert.strictEqual(modulePlan.dimensionText, '4.48 × 2.4 m')
    assert.strictEqual(modulePlan.installedWidthMeters, modulePlan.screenWidthMeters + 0.1)
    assert.strictEqual(modulePlan.installedHeightMeters, modulePlan.screenHeightMeters + 0.1)
    assert(modulePlan.installedWidthMeters <= 6)
    assert(modulePlan.actualTopMarginMeters >= 0.2)
    assert(modulePlan.actualBottomMarginMeters >= 0.2)
    assert.strictEqual(modulePlan.targetAspectRatioKey, '16:9')
    assert(calculateLedScreenPlan({
      wallWidthMeters: 6,
      wallHeightMeters: 3,
      topReserveMeters: 0.2,
      bottomReserveMeters: 0.2,
      viewingDistanceMeters: 3,
      unitKey: 'module',
      pixelPitch: 0.9375,
    }).error)
    assert(calculateLedScreenPlan({
      wallWidthMeters: 1,
      wallHeightMeters: 1,
      topReserveMeters: 0,
      bottomReserveMeters: 0,
      frameWidthMeters: 0.5,
      viewingDistanceMeters: 3,
      unitKey: 'module',
      pixelPitch: 1.25,
    }).error)

    ;['16:9', '4:3', '21:9', '16:10', '32:9'].forEach((aspectRatioKey) => {
      const ratioPlan = calculateLedScreenPlan({
        wallWidthMeters: 12,
        wallHeightMeters: 4,
        topReserveMeters: 0.1,
        bottomReserveMeters: 0.1,
        viewingDistanceMeters: 4,
        aspectRatioKey,
        unitKey: 'module',
        pixelPitch: 'recommended',
      })
      assert.strictEqual(ratioPlan.error, undefined)
      assert.strictEqual(ratioPlan.targetAspectRatioKey, aspectRatioKey)
      assert(ratioPlan.screenWidthMeters <= 12)
      assert(ratioPlan.screenHeightMeters <= 3.8)
    })

    const premiumPlan = calculateLedScreenPlan({
      wallWidthMeters: 6.4,
      wallHeightMeters: 3.2,
      topReserveMeters: 0.1,
      bottomReserveMeters: 0.1,
      viewingDistanceMeters: 3,
      unitKey: 'cabinetPremiumA',
      pixelPitch: 1.86,
    })
    assert.strictEqual(premiumPlan.error, undefined)
    assert.strictEqual(premiumPlan.unitLabel, '高端 A 系列')
    assert.strictEqual(premiumPlan.ratioCloseToTarget, true)
    assert.strictEqual(premiumPlan.pitchMode, 'specified')
    assert.strictEqual(premiumPlan.statusKey, 'near')
    assert(calculateLedScreenPlan({
      wallWidthMeters: 1,
      wallHeightMeters: 0.4,
      topReserveMeters: 0.2,
      bottomReserveMeters: 0.2,
      viewingDistanceMeters: 3,
      unitKey: 'module',
      pixelPitch: 1.25,
    }).error)
  }

  function checkData() {
    assert.strictEqual(APP_VERSION, '6.0.0')
    assert.strictEqual(PRODUCT_DATA_DATE, '2026-09-01')
    assert.strictEqual(fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(), APP_VERSION)
    assert(Object.isFrozen(PRODUCT_COUNTS), '产品资料库数量统计必须冻结')
    assert.strictEqual(amplifiers.length, 38, '功放产品数量发生变化，请复核资料')
    assert.strictEqual(speakers.length, 148, '音箱产品数量发生变化，请复核资料')
    assertUnique(amplifiers, (item) => item.model, '功放产品库')
    assertUnique(speakers, (item) => item.model, '音箱产品库')
    assert.strictEqual(cameras.length, 26, '摄像机产品数量发生变化，请复核资料')
    assert.deepStrictEqual(PRODUCT_COUNTS, {
      amplifier: amplifiers.length,
      speaker: speakers.length,
      camera: cameras.length,
      lighting: stageLightingProducts.length,
    }, '首页产品统计与实际产品库不一致')
    assertUnique(cameras, (item) => item.model, '摄像机产品库')
    assert.strictEqual(stageLightingProducts.length, 149, '舞台灯光产品数量发生变化，请复核资料')
    assertUnique(stageLightingProducts, (item) => item.model, '舞台灯光产品库')
    assert.deepStrictEqual(
      stageLightingProducts.reduce((counts, item) => ({
        ...counts,
        [item.category]: (counts[item.category] || 0) + 1,
      }), {}),
      { 电源直通箱: 10, 灯光控台: 16, 灯具: 123 },
    )
    assert.strictEqual(dmxFixtures.length, 121, '可自动编址灯具数量异常')
    stageLightingProducts.forEach((item) => {
      assert(item.model && item.name && item.category && item.source, '舞台灯光产品资料不完整')
      assert(['control', 'fixture', 'power'].includes(item.categoryKey), `${item.model} 设备分类无效`)
      assert(Array.isArray(item.channelModes), `${item.model} 通道模式格式无效`)
      assert(item.channelModes.every((mode) => Number.isInteger(mode) && mode > 0 && mode <= 512), `${item.model} 通道模式数值无效`)
      assert.strictEqual(new Set(item.channelModes).size, item.channelModes.length, `${item.model} 通道模式重复`)
      assert.strictEqual(item.dmxAddressable, item.categoryKey === 'fixture' && item.channelModes.length > 0)
    })
    assert.deepStrictEqual(
      stageLightingProducts
        .filter((item) => item.categoryKey === 'fixture' && !item.dmxAddressable)
        .map((item) => item.model),
      ['TL-SL622', 'TL-SL643'],
    )
    assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SE3401').channelModes, [4, 16, 88, 168])
    assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SL344').channelModes, [2, 4, 6, 8, 12])
    assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SV3103').channelModes, [14, 16, 18])
    assert.deepStrictEqual(findByModel(stageLightingProducts, 'TL-SL326').channelModes, [1])
    assert.strictEqual(new Set(cameras.map((item) => item.source)).size, 21, '摄像机说明书来源数量异常')
    assert(cameras.every((item) => item.source.startsWith('itc产品说明书 ')), '摄像机说明书文件名未按桌面原文件记录')
    cameras.forEach((item) => {
      assert(item.model && item.source && item.sourcePages, '摄像机缺少型号、资料来源或参数页')
      assert(['ptz', 'fixed', 'eptz', 'mixed'].includes(item.mountType), `${item.model} 缺少安装结构分类`)
      assert(item.views?.length, `${item.model} 缺少镜头视角数据`)
      item.views.forEach((view, viewIndex) => {
        assert(view.hWide > 0, `${item.model} 的 ${view.label} 缺少水平视场角`)
        const wide = resolveLibraryFov(item, viewIndex, 'wide')
        if (view.vWide > 0) {
          assert.strictEqual(wide.horizontalFov, view.hWide)
          assert.strictEqual(wide.verticalFov, view.vWide)
        } else assert.strictEqual(wide, null, `${item.model} 缺少厂家垂直角却进入了计算`)

        const tele = resolveLibraryFov(item, viewIndex, 'tele')
        if (view.hTele > 0 && view.vTele > 0) {
          assert.strictEqual(tele.horizontalFov, view.hTele)
          assert.strictEqual(tele.verticalFov, view.vTele)
        } else assert.strictEqual(tele, null, `${item.model} 缺少厂家长焦双轴角却进入了计算`)
      })
    })
    assert.strictEqual(cameras.filter((item) => getCalculableCameraViews(item).length).length, 16)
    assert.strictEqual(cameras.filter((item) => getHorizontalCameraViews(item).length).length, 26)
    assert.deepStrictEqual(
      cameras.filter((item) => !getCalculableCameraViews(item).length).map((item) => item.model),
      ['TS-0663JS', 'TS-0663XS', 'TS-0663JSM', 'TS-0663XSM', 'TV-6104HK', 'TV-6124UK', 'TV-612KM', 'TV-620KL', 'TV-620KM', 'TV-MU650X'],
    )
    amplifiers.forEach((item) => {
      assert(item.model && item.source, '功放缺少型号或资料来源')
      assert(Object.keys(item.stereoPower || {}).length, `${item.model} 缺少立体声功率数据`)
    })
    assert.deepStrictEqual(
      Object.keys(amplifierInputStages).sort(),
      amplifiers.map((item) => item.model).sort(),
      '功放输入级参数与当前功放产品库不一致',
    )
    Object.entries(amplifierInputStages).forEach(([model, stage]) => {
      assert(['inputSensitivity', 'voltageGain'].includes(stage.controlType), `${model} 输入级控制类型无效`)
      assert(['V', 'dBu', 'dB'].includes(stage.unit), `${model} 输入级单位无效`)
      assert(stage.options.length && stage.options.every(Number.isFinite), `${model} 输入级档位无效`)
      assert.strictEqual(new Set(stage.options).size, stage.options.length, `${model} 输入级档位重复`)
      assert(stage.source && stage.sourcePages.length, `${model} 缺少输入级参数来源`)
      assert(stage.sourcePages.every((page) => Number.isInteger(page) && page > 0), `${model} 参数页码无效`)
      assert.strictEqual(stage.verification, 'manual-page', `${model} 输入级参数未经原页复核`)
    })
    assert.deepStrictEqual(amplifierInputStages['TC-22000'].options, [33, 36, 39, 42])
    assert.deepStrictEqual(amplifierInputStages['TC-41500DT'].options, [2, 6, 12])
    assert.strictEqual(amplifierInputStages['TC-41500DT'].maximumInputDbu, 20)
    assert.deepStrictEqual(amplifierInputStages['TC-4200B'].options, [1])
    assert.strictEqual(amplifierInputStages['TC-X2200B'].defaultValue, 1)
    speakers.forEach((item) => {
      assert(item.model && item.source, '音箱缺少型号或资料来源')
      assert(item.ratedPower > 0 && item.impedance > 0, `${item.model} 缺少额定功率或阻抗`)
    })

    const missingSensitivity = speakers
      .filter((item) => !Number.isFinite(item.sensitivityDb))
      .map((item) => item.model)
      .sort()
    assert.deepStrictEqual(missingSensitivity, ['KS-153', 'TS-403C'])

    assert.strictEqual(Object.keys(speakerSpecifications).length, 148)
    assert.deepStrictEqual(Object.keys(speakerSpecifications).sort(), speakers.map((item) => item.model).sort())
    assert.strictEqual(Object.values(speakerSpecifications).filter((item) => Number.isFinite(item.peakPower)).length, 67)
    assert.strictEqual(Object.values(speakerSpecifications).filter((item) => Number.isFinite(item.maximumSplDb)).length, 132)
    assert.strictEqual(Object.values(speakerSpecifications).filter((item) => item.horizontalCoverageDeg != null || item.verticalCoverageDeg != null || item.verticalCoverage != null).length, 103)
    const splitBandModels = ['KS-153', 'KS-208A', 'TS-405HBS', 'TX-1508', 'TX-1510']
    assert.deepStrictEqual(speakers.filter((item) => item.calculationDisabled).map((item) => item.model).sort(), splitBandModels)
    assert.deepStrictEqual(Object.keys(speakerSpecifications).filter((model) => speakerSpecifications[model].bands).sort(), splitBandModels)
    assert.strictEqual(findByModel(speakers, 'TS-108R').sensitivityDb, 91)
    assert.deepStrictEqual(
      (({ ratedPower, impedance, minimumFrequency, sensitivityDb }) => ({ ratedPower, impedance, minimumFrequency, sensitivityDb }))(
        findByModel(speakers, 'TS-208R'),
      ),
      { ratedPower: 100, impedance: 8, minimumFrequency: 60, sensitivityDb: 92 },
    )
    assert.deepStrictEqual(
      (({ ratedPower, impedance, minimumFrequency, sensitivityDb }) => ({ ratedPower, impedance, minimumFrequency, sensitivityDb }))(
        findByModel(speakers, 'TS-208RH'),
      ),
      { ratedPower: 200, impedance: 8, minimumFrequency: 50, sensitivityDb: 92 },
    )
    assert.strictEqual(speakerSpecifications['TS-208R'].maximumSplDb, 112)
    assert.strictEqual(speakerSpecifications['TS-208R'].directivityAdjustmentDeg, 12)
    assert.strictEqual(speakerSpecifications['TS-208RH'].maximumPower, 400)
    assert.strictEqual(speakerSpecifications['TS-208RH'].maximumSplToleranceDb, 3)
    assert.strictEqual(speakerSpecifications['TS-208RH'].sourcePage.page, 2)
    assert.strictEqual(findByModel(speakers, 'LA-2800').ratedPower, 500)
    assert.strictEqual(findByModel(speakers, 'LA-2800').minimumFrequency, 70)
    assert.strictEqual(findByModel(speakers, 'KS-405').impedance, 16)
    assert.strictEqual(findByModel(speakers, 'TS-610W').peakPower, 1200)
    assert(!speakers.some((item) => item.model === 'TS-603B-603W'))

    assertUnique(knowledgeItems, (item) => item.id, '扩声知识库')
    knowledgeItems.forEach((item) => assert.strictEqual(findKnowledgeById(item.id), item))
    assert.deepStrictEqual(
      knowledgeItems.filter((item) => item.visualType).map((item) => item.visualType),
      ['limiter', 'distance', 'cable', 'fill', 'gain', 'camera', 'dmx', 'led'],
      '八个工具的知识图解未完整对应',
    )
    const ledArticle = findKnowledgeById('led-screen-fit')
    assert(ledArticle && ledArticle.category === '视频' && ledArticle.visualType === 'led')
    assert(ledArticle.visualTitle.includes('净屏') && ledArticle.visualConclusion.includes('含包边外尺寸'))
    assert(ledArticle.title.includes('净屏') && ledArticle.title.includes('包边'))
    assert(ledArticle.path.includes('id=led-screen-fit') && ledArticle.relatedPath === '/pages/led-screen/led-screen')
    const ledText = ledArticle.sections.map((section) => [section.title].concat(section.paragraphs, section.formulas).join('')).join('')
    assert(ledText.includes('320 × 160 mm') && ledText.includes('8 × 9 = 72') && ledText.includes('2.66 × 1.54 m'))
    assert.strictEqual(ledArticle.sections.flatMap((section) => section.formulas).length, 6)
    assert(knowledgeItems.filter((item) => item.category === '音频').length === 5)
    assert(knowledgeItems.filter((item) => item.category === '视频').length === 2)
    assert(knowledgeItems.filter((item) => item.category === '灯光').length === 1)
    const dmxArticle = findKnowledgeById('dmx-address-basics')
    assert(dmxArticle.title.includes('DMX 地址') && dmxArticle.formulaNote.includes('仅演示连续自动'))
    assert(dmxArticle.sections.some((section) => section.title.includes('按组分域')
      && section.paragraphs.join('').includes('A、B')
      && section.paragraphs.join('').includes('输出域与两条物理线路映射')))
    assert(dmxArticle.sections.some((section) => section.bullets.join('').includes('不自动溢出')
      && section.bullets.join('').includes('拆组或换域')))
    assert.strictEqual(findKnowledgeById('missing-article'), null)

    const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
    collectMediaFiles(path.join(root, 'assets')).forEach((file) => {
      assert(fs.statSync(file).size <= 200 * 1024, `图片或音频超过 200 KB：${path.relative(root, file)}`)
    })
    const packageMediaFiles = collectMediaFiles(root).filter((file) => {
      const relativePath = path.relative(root, file).replace(/\\/g, '/')
      return !projectConfig.packOptions.ignore.some((item) => (
        item.type === 'file'
          ? relativePath === item.value
          : relativePath === item.value || relativePath.startsWith(`${item.value}/`)
      ))
    })
    const packageMediaBytes = packageMediaFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
    assert(packageMediaBytes <= PACKAGE_BUDGETS.media,
      `代码包图片和音频合计超过 ${formatKiB(PACKAGE_BUDGETS.media)}：${packageMediaBytes} bytes`)
    const packIgnore = new Map(projectConfig.packOptions.ignore.map((item) => [item.value, item.type]))
    assert.strictEqual(packIgnore.get('docs'), 'folder')
    assert.strictEqual(packIgnore.get('tests'), 'folder')
    ;['AGENTS.md', 'CHANGELOG.md', 'DESIGN.md', 'README.md', 'UI_RULES_README.md', 'VERSION']
      .forEach((file) => assert.strictEqual(packIgnore.get(file), 'file', `${file} 未从正式包排除`))
    ;['limiter', 'spl', 'cable', 'camera', 'gain-structure', 'dmx-address']
      .forEach((name) => assert.strictEqual(
        packIgnore.get(`assets/home/module-${name}.jpg`),
        'file',
        `旧版模块图片 module-${name}.jpg 未从正式包排除`,
      ))
    const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
    const registeredPages = getRegisteredPagePaths(appConfig)
    assert(!appConfig.pages.includes('pages/records/records'))
    assert(appConfig.pages.includes('pages/records/project'))
    assert(appConfig.pages.includes('pages/products/library'))
    assert(appConfig.pages.includes('pages/products/detail'))
    assert(appConfig.pages.includes('pages/camera/camera'))
    assert(appConfig.pages.includes('pages/led-screen/led-screen'))
    assert(appConfig.pages.includes('pages/gain-structure/gain-structure'))
    assert(registeredPages.includes('pages/dmx-address/dmx-address'))

    const amplifierCatalog = getProductList('amplifier')
    const speakerCatalog = getProductList('speaker')
    const cameraCatalog = getProductList('camera')
    const lightingCatalog = getProductList('lighting')
    assert.strictEqual(amplifierCatalog.length, 38)
    assert.strictEqual(speakerCatalog.length, 148)
    assert.strictEqual(cameraCatalog.length, 26)
    assert.strictEqual(lightingCatalog.length, 149)
    assert.strictEqual(getProductList('amplifier'), amplifierCatalog, '功放目录未复用静态缓存')
    assert.strictEqual(getProductList('speaker'), speakerCatalog, '音箱目录未复用静态缓存')
    assert.strictEqual(getProductList('camera'), cameraCatalog, '摄像机目录未复用静态缓存')
    assert.strictEqual(getProductList('lighting'), lightingCatalog, '舞台灯光目录未复用静态缓存')
    assert(getCategories('speaker').includes('TS系列'))
    assert(filterProducts('speaker', '803', '全部').some((item) => item.model === 'TS-803C'))
    assert(filterProducts('speaker', '', '全部', 'coverage').length >= 99)
    assert.strictEqual(filterProducts('camera', '', '全部', 'cameraFov').length, 26)
    assert(filterProducts('camera', '6124', '全部').some((item) => item.model === 'TV-6124HK'))
    assert.strictEqual(filterProducts('lighting', '', '全部', 'dmxAddress').length, 121)
    assert(filterProducts('lighting', '超级帕灯', '灯具').some((item) => item.model === 'TL-SL342B'))
    assert(getCategories('lighting').includes('灯光控台'))
    const productComparison = buildProductComparison('speaker', ['TS-603C', 'TS-803C'])
    assert.deepStrictEqual(productComparison.models, ['TS-603C', 'TS-803C'])
    assert(productComparison.rows.some((row) => row.label === '额定功率' && row.different))
    const speakerDetail = getProductDetail('speaker', 'TS-803C')
    assert.strictEqual(speakerDetail.reviewDate, PRODUCT_DATA_DATE)
    assert.strictEqual(speakerDetail.sensitivityDb, 95)
    assert.strictEqual(speakerDetail.maximumSplText, '120 dB SPL')
    assert.strictEqual(speakerDetail.coverageText, '100° × 90°')
    const ts208rhDetail = getProductDetail('speaker', 'TS-208RH')
    assert.strictEqual(ts208rhDetail.powerLimitLabel, '最大功率')
    assert.strictEqual(ts208rhDetail.powerLimitText, '400 W')
    assert.strictEqual(ts208rhDetail.sensitivityText, '92 ±3 dB')
    assert.strictEqual(ts208rhDetail.maximumSplText, '115 ±3 dB SPL')
    assert.strictEqual(ts208rhDetail.sourcePageText, '规格页码：第 2 页')
    const splitBandDetail = getProductDetail('speaker', 'KS-153')
    assert.strictEqual(splitBandDetail.bandRows.length, 2)
    assert.strictEqual(splitBandDetail.bandRows[0].soundPressureText, '额定 126 / 峰值 132 dB SPL')
    assert.strictEqual(splitBandDetail.modules.find((item) => item.key === 'limiter').actionable, false)
    assert.strictEqual(splitBandDetail.modules.find((item) => item.key === 'spl').actionable, false)
    assert.strictEqual(speakerDetail.sourcePageText, '规格页码：第 2 页')
    const cameraDetail = getProductDetail('camera', 'TV-6124HK')
    assert.strictEqual(cameraDetail.viewRows[0].horizontalText, '71–8.2°')
    assert.strictEqual(cameraDetail.viewRows[0].verticalText, '42.7–4.5°')
    assert.strictEqual(cameraDetail.modules[0].actionable, true)
    assert.strictEqual(cameraDetail.sourcePageText, '规格页码：第 5 页')
    const incompleteCameraDetail = getProductDetail('camera', 'TV-MU650X')
    assert.strictEqual(incompleteCameraDetail.modules[0].actionable, true)
    assert.strictEqual(incompleteCameraDetail.mountLabel, '机械云台')
    assert.strictEqual(incompleteCameraDetail.viewRows[0].statusLabel, '仅水平预估')
    assert(incompleteCameraDetail.missingParameters.includes('主镜头：垂直视场角'))
    const lightingDetail = getProductDetail('lighting', 'TL-SV3103')
    assert.deepStrictEqual(lightingDetail.modeRows.map((item) => item.value), [14, 16, 18])
    assert.strictEqual(lightingDetail.modules[0].key, 'dmxAddress')
    assert.strictEqual(lightingDetail.modules[0].actionable, true)
    const manualLightingDetail = getProductDetail('lighting', 'TL-SL643')
    assert.strictEqual(manualLightingDetail.modules[0].actionable, false)
  }

  function checkBaselines() {
    const camera = findByModel(cameras, 'TV-6124HK')
    const wideCoverage = calculateCoverage(resolveLibraryFov(camera, 0, 'wide'), { distanceMeters: 5 })
    assert.strictEqual(wideCoverage.coverageWidthMeters, 7.13)
    assert.strictEqual(wideCoverage.coverageHeightMeters, 3.91)
    assert.strictEqual(wideCoverage.horizontalFov, 71)
    assert.strictEqual(wideCoverage.verticalSource, '厂家说明书标注')
    assert.strictEqual(resolveLibraryFov(camera, 0, 'wide').endpointLabel, '广角端全景')

    const teleDistance = calculateCoverage(resolveLibraryFov(camera, 0, 'tele'), {
      calculationMode: 'targetWidth',
      targetWidthMeters: 6,
    })
    assert.strictEqual(teleDistance.distanceMeters, 41.85)
    assert.strictEqual(teleDistance.coverageHeightMeters, 3.29)
    assert.strictEqual(resolveLibraryFov(camera, 0, 'tele').endpointLabel, '长焦端全区域参考')
    assert.strictEqual(resolveLibraryFov(findByModel(cameras, 'TV-MU650X'), 0, 'wide'), null)
    assert.strictEqual(resolveLibraryFov(findByModel(cameras, 'TV-6104HK'), 0, 'wide'), null)
    assert.strictEqual(resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide').horizontalFov, 110)
    assert.strictEqual(resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide').horizontalOnly, true)
    assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0663JP')), 'eptz')
    assert.strictEqual(getCameraMountLabel(findByModel(cameras, 'TS-0663JP')), '电子云台（固定安装）')
    assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0650JSM'), 0), 'ptz')
    assert.strictEqual(getCameraMountType(findByModel(cameras, 'TS-0650JSM'), 1), 'fixed')
    assert.strictEqual(resolveCustomFov({ definitionMode: 'angles', horizontalFov: 60 }), null)

    const customCoverage = calculateCoverage(resolveCustomFov({
      definitionMode: 'sensor',
      sensorWidth: 6.4,
      sensorHeight: 3.6,
      focalLength: 4.5,
    }), { distanceMeters: 5 })
    assert.strictEqual(customCoverage.coverageWidthMeters, 7.11)
    assert.strictEqual(customCoverage.coverageHeightMeters, 4)

    const groundPlacement = calculateGroundAreaPlacement(resolveLibraryFov(camera, 0, 'wide'), {
      widthMeters: 6,
      depthMeters: 4,
      subjectHeightMeters: 1.8,
      heightMode: 'auto',
      marginRatio: 0.1,
    })
    assert.strictEqual(groundPlacement.cameraSetbackMeters, 4.65)
    assert.strictEqual(groundPlacement.cameraHeightMeters, 2.3)
    assert.strictEqual(groundPlacement.requiredVerticalFov, 25.2)
    assert.strictEqual(groundPlacement.framingVersion, 2)
    assert.strictEqual(groundPlacement.effectiveDepthMeters, 4)
    assert.strictEqual(groundPlacement.depthMarginMeters, 0)
    const legacyGroundPlacement = calculateGroundAreaPlacement(resolveLibraryFov(camera, 0, 'wide'), {
      widthMeters: 6, depthMeters: 4, subjectHeightMeters: 1.8, heightMode: 'auto', marginRatio: 0.1,
      calculationVersion: 1,
    })
    assert.strictEqual(legacyGroundPlacement.cameraSetbackMeters, 4.83, '历史记录保留旧退距')
    assert.strictEqual(legacyGroundPlacement.requiredVerticalFov, 24.4, '历史记录保留旧垂直角')
    assert(groundPlacement.requiredHorizontalFov <= groundPlacement.horizontalFov)
    assert(groundPlacement.requiredVerticalFov <= groundPlacement.verticalFov)
    assert(groundPlacement.cameraSetbackMeters
      * Math.tan(groundPlacement.requiredHorizontalFov * Math.PI / 360)
      >= groundPlacement.widthMeters / 2, '水平构图包络没有覆盖区域近端两角')
    assert.strictEqual(
      groundPlacement.distanceConstraintText,
      '水平下限处垂直校核通过',
    )

    const planePlacement = calculateVerticalPlanePlacement(resolveLibraryFov(camera, 0, 'wide'), {
      widthMeters: 6,
      heightMeters: 2.5,
      bottomHeightMeters: 0.8,
      heightMode: 'auto',
      marginRatio: 0.1,
    })
    assert.strictEqual(planePlacement.distanceMeters, 4.63)
    assert.strictEqual(planePlacement.cameraHeightMeters, 2.05)
    assert.strictEqual(planePlacement.frameWidthMeters, 6.6)
    assert.strictEqual(planePlacement.frameHeightMeters, 3.62)
    assert(planePlacement.requiredHorizontalFov <= planePlacement.horizontalFov)
    assert(planePlacement.requiredVerticalFov <= planePlacement.verticalFov)

    const horizontalOnlyPlacement = calculateHorizontalOnlyPlacement(
      resolveLibraryOptics(findByModel(cameras, 'TV-MU650X'), 0, 'wide'),
      {
        sceneMode: 'ground',
        widthMeters: 6,
        depthMeters: 4,
        subjectHeightMeters: 1.8,
        heightMode: 'auto',
        marginRatio: 0.1,
      },
    )
    assert.strictEqual(horizontalOnlyPlacement.cameraSetbackMeters, 2.31)
    assert.strictEqual(horizontalOnlyPlacement.horizontalOnly, true)
    assert.strictEqual(horizontalOnlyPlacement.verticalFov, null)
    assert(horizontalOnlyPlacement.distanceConstraintText.includes('不能校核上下边界'))

    const limiter = calculateLimiter({
      amplifier: findByModel(amplifiers, 'TC-2350B'),
      speaker: findByModel(speakers, 'TS-803C'),
      count: 1,
      wiring: 'parallel',
      mode: 'stereo',
      sensitivityVoltage: 1,
      highPassFrequency: 80,
    })
    assert.strictEqual(limiter.thresholdDbfs, -19.2)
    assert.strictEqual(limiter.attackTimeMs, 8)
    assert.strictEqual(limiter.releaseTimeMs, 128)
    assert.strictEqual(limiter.targetOutputVoltage, 34.64)

    const limiterWithoutTiming = calculateLimiter({
      amplifier: findByModel(amplifiers, 'TC-2350B'),
      speaker: findByModel(speakers, 'TS-803C'),
      count: 1,
      wiring: 'parallel',
      mode: 'stereo',
      sensitivityVoltage: 1,
      highPassFrequency: null,
    })
    assert.strictEqual(limiterWithoutTiming.valid, true)
    assert.strictEqual(limiterWithoutTiming.timingReady, false)
    assert.strictEqual(limiterWithoutTiming.thresholdDbfs, -19.2)
    assert.strictEqual(limiterWithoutTiming.attackTimeMs, undefined)

    const sensitivityGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-2350B'),
      inputStage: amplifierInputStages['TC-2350B'],
      selectedStageValue: 1,
    })
    assert.strictEqual(sensitivityGainStructure.valid, true)
    assert.strictEqual(sensitivityGainStructure.fullPowerInputVoltage, 1)
    assert.strictEqual(sensitivityGainStructure.fullPowerInputDbu, 2.21)
    assert.strictEqual(sensitivityGainStructure.dspMaxOutputDbu, 18.4)
    assert.strictEqual(sensitivityGainStructure.targetDspOutputDbu, 12.4)
    assert.strictEqual(sensitivityGainStructure.nominalDspOutputDbu, 0.4)
    assert.strictEqual(sensitivityGainStructure.naturalFullPowerDbfs, -16.19)
    assert.strictEqual(sensitivityGainStructure.recommendedAttenuationDb, 10.19)
    assert.strictEqual(sensitivityGainStructure.nominalDspDbfs, -18)
    assert.strictEqual(sensitivityGainStructure.availableAmplifierHeadroomDb, 12)
    assert.strictEqual(sensitivityGainStructure.alignmentMode, 'attenuate')

    const explicitLegacyCalibration = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-2350B'),
      inputStage: amplifierInputStages['TC-2350B'],
      selectedStageValue: 1,
      dspMaxOutputDbu: 18,
    })
    assert.strictEqual(explicitLegacyCalibration.dspMaxOutputDbu, 18)
    assert.strictEqual(explicitLegacyCalibration.targetDspOutputDbu, 12)
    assert.strictEqual(explicitLegacyCalibration.naturalFullPowerDbfs, -15.79)
    assert.strictEqual(explicitLegacyCalibration.recommendedAttenuationDb, 9.79)

    const twoVoltGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-2350B'),
      inputStage: amplifierInputStages['TC-2350B'],
      selectedStageValue: 2,
    })
    assert.strictEqual(twoVoltGainStructure.fullPowerInputDbu, 8.23)
    assert.strictEqual(twoVoltGainStructure.recommendedAttenuationDb, 4.17)

    const sameSensitivityDifferentModel = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-2500B'),
      inputStage: amplifierInputStages['TC-2500B'],
      selectedStageValue: 1,
    })
    assert.strictEqual(
      sameSensitivityDifferentModel.recommendedAttenuationDb,
      sensitivityGainStructure.recommendedAttenuationDb,
      '同为1 V输入灵敏度的不同型号不应产生不同对齐衰减',
    )

    const thresholdCrossingGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-41500DT'),
      inputStage: amplifierInputStages['TC-41500DT'],
      selectedStageValue: 12,
    })
    assert.strictEqual(thresholdCrossingGainStructure.fullPowerInputDbu, 12)
    assert.strictEqual(thresholdCrossingGainStructure.naturalFullPowerDbfs, -6.4)
    assert.strictEqual(thresholdCrossingGainStructure.recommendedAttenuationDb, 0.4)
    assert.strictEqual(thresholdCrossingGainStructure.alignmentMode, 'attenuate')

    const directGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-41500DT'),
      inputStage: amplifierInputStages['TC-41500DT'],
      selectedStageValue: 12,
      targetPeakDbfs: -6.4,
    })
    assert.strictEqual(directGainStructure.targetDspOutputDbu, 12)
    assert.strictEqual(directGainStructure.naturalFullPowerDbfs, -6.4)
    assert.strictEqual(directGainStructure.recommendedAttenuationDb, 0)
    assert.strictEqual(directGainStructure.alignmentMode, 'direct')

    const shortfallGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-41500DT'),
      inputStage: amplifierInputStages['TC-41500DT'],
      selectedStageValue: 12,
      targetPeakDbfs: -12,
    })
    assert.strictEqual(shortfallGainStructure.alignmentMode, 'insufficientDrive')
    assert.strictEqual(shortfallGainStructure.driveShortfallDb, 5.6)
    assert.strictEqual(shortfallGainStructure.recommendedAttenuationDb, 0)

    const voltageGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-22000'),
      inputStage: amplifierInputStages['TC-22000'],
      selectedStageValue: 42,
      mode: 'stereo',
      loadImpedance: 8,
    })
    assert.strictEqual(voltageGainStructure.calculationBasis, 'ratedPowerAndVoltageGain')
    assert.strictEqual(voltageGainStructure.amplifierRatedPower, 2000)
    assert.strictEqual(voltageGainStructure.fullPowerInputVoltage, 1.005)
    assert.strictEqual(voltageGainStructure.fullPowerInputDbu, 2.26)
    assert.strictEqual(voltageGainStructure.recommendedAttenuationDb, 10.14)

    const missingStageSelection = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-22000'),
      inputStage: amplifierInputStages['TC-22000'],
      mode: 'stereo',
      loadImpedance: 8,
    })
    assert.strictEqual(missingStageSelection.valid, false)
    assert(missingStageSelection.warning.includes('核对后面板拨码'))

    const unsupportedGainLoad = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-22000'),
      inputStage: amplifierInputStages['TC-22000'],
      selectedStageValue: 42,
      mode: 'stereo',
      loadImpedance: 3,
    })
    assert.strictEqual(unsupportedGainLoad.valid, false)
    assert(unsupportedGainLoad.warning.includes('无法反算3Ω'))

    const invalidDigitalPeak = calculateGainStructure({
      inputStage: amplifierInputStages['TC-2350B'],
      selectedStageValue: 1,
      targetPeakDbfs: 1,
    })
    assert.strictEqual(invalidDigitalPeak.valid, false)

    const manualDefaultGainStructure = calculateGainStructure({
      amplifier: findByModel(amplifiers, 'TC-X2200B'),
      inputStage: amplifierInputStages['TC-X2200B'],
    })
    assert.strictEqual(manualDefaultGainStructure.valid, true)
    assert.strictEqual(manualDefaultGainStructure.selectionSource, 'manualDefault')

    const spl = calculateSpeakerSpl({
      speaker: findByModel(speakers, 'TS-803C'),
      distanceMeters: 4,
      speakerCount: 1,
      summationMode: 'distributed',
    })
    assert.strictEqual(spl.oneMeterSpl, 119.8)
    assert.strictEqual(spl.selectedSpl, 107.7)

    const constantCable = calculateConstantVoltageCable({
      totalPowerW: 100,
      distanceMeters: 100,
      environment: 'indoor',
    })
    assert.strictEqual(constantCable.spec, 'RVV2×0.5 mm²')
    assert.strictEqual(constantCable.designPowerW, 150)
    assert.strictEqual(constantCable.formulaMinimumArea, 0.08)

    const professionalCable = calculateProfessionalSpeakerCable({
      totalPowerW: 300,
      distanceMeters: 50,
    })
    assert.strictEqual(professionalCable.spec, '秋叶原 300 芯×2 金银线')
    assert.strictEqual(professionalCable.currentA, 12)


  }

  return {
    checkCatalogSelector,
    checkLedScreenPlan,
    checkData,
    checkBaselines,
  }
}

module.exports = { createCalculationChecks }
