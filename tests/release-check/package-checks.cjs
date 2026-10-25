function createPackageChecks(context) {
  const {
    assert,
    fs,
    path,
    vm,
    root,
    themeAliasMap,
    evaluateDraftProtocolPackageGate,
  } = context

  const PACKAGE_BUDGETS = Object.freeze({
    total: 5120 * 1024,
    // Source-only ceiling; the compiled WeChat package still needs a DevTools size check.
    mainTotal: 2460 * 1024,
    mainJavaScript: 1536 * 1024,
    subPackageJavaScript: 352 * 1024,
    '.wxss': 576 * 1024,
    '.wxml': 368 * 1024,
    media: 1680 * 1024,
    singleJavaScript: 160 * 1024,
  })

  const EXPECTED_APP_PAGES = Object.freeze([
    'pages/index/index',
    'pages/tools/tools',
    'pages/projects/projects',
    'pages/settings/settings',
    'pages/basis/detail',
    'pages/projects/favorite-detail',
    'pages/projects/recovery',
    'pages/records/report',
    'pages/limiter/limiter',
    'pages/spl/spl',
    'pages/cable/cable',
    'pages/audio-wiring/index',
    'pages/audio-wiring/report-bridge',
    'pages/camera/camera',
    'pages/led-screen/led-screen',
    'pages/gain-structure/gain-structure',
    'pages/dmx-address/dmx-address',
    'pages/dmx-address/channel-guide',
    'pages/dmx-layout/dmx-layout',
    'pages/products/library',
    'pages/products/detail',
    'pages/records/project',
    'pages/project-wiring/index',
    'pages/project-wiring/report-bridge',
    'pages/knowledge/detail',
    'pages/troubleshoot/index',
    'pages/control-protocol/index',
    'pages/control-protocol/detail',
  ])

  const SENSITIVE_WECHAT_APIS = Object.freeze([
    {
      category: '网络请求',
      apis: ['request', 'uploadFile', 'downloadFile', 'connectSocket'],
    },
    {
      category: '登录与用户身份',
      apis: ['login', 'getUserProfile', 'getUserInfo', 'getWeRunData'],
    },
    {
      category: '位置',
      apis: [
        'getLocation',
        'getFuzzyLocation',
        'chooseLocation',
        'openLocation',
        'startLocationUpdate',
        'startLocationUpdateBackground',
        'onLocationChange',
      ],
    },
    {
      category: '麦克风',
      apis: ['getRecorderManager', 'startRecord', 'stopRecord', 'joinVoIPChat'],
    },
    {
      category: '摄像头与采集',
      apis: ['createCameraContext', 'chooseMedia', 'chooseImage', 'scanCode'],
    },
  ])

  function getRegisteredPagePaths(appConfig) {
    const subPackagePages = (appConfig.subPackages || []).flatMap((subPackage) => (
      (subPackage.pages || []).map((pagePath) => `${subPackage.root}/${pagePath}`)
    ))
    return [...(appConfig.pages || []), ...subPackagePages]
  }

  function getPackageGroups(packageFiles, appConfig) {
    const subPackages = appConfig.subPackages || []
    const definitions = [
      { name: '主包', root: '' },
      ...subPackages.map((subPackage) => ({ name: `分包 ${subPackage.root}`, root: subPackage.root })),
    ]
    return definitions.map((definition) => ({
      ...definition,
      files: packageFiles.filter((file) => {
        const relativePath = normalizeRelativePath(file)
        return definition.root
          ? relativePath === definition.root || relativePath.startsWith(`${definition.root}/`)
          : !subPackages.some((subPackage) => (
            relativePath === subPackage.root || relativePath.startsWith(`${subPackage.root}/`)
          ))
      }),
    }))
  }

  function findSubPackageRequires(files, subPackageRoots) {
    const matches = []
    files.filter((file) => path.extname(file).toLowerCase() === '.js').forEach((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g
      let match
      while ((match = requirePattern.exec(source))) {
        const request = match[1]
        const resolved = request.startsWith('.')
          ? normalizeRelativePath(path.resolve(path.dirname(file), request))
          : request.replace(/\\/g, '/')
        if (subPackageRoots.some((rootPath) => (
          resolved === rootPath || resolved.startsWith(`${rootPath}/`)
        ))) {
          matches.push({ file: normalizeRelativePath(file), request })
        }
      }
    })
    return matches
  }

  function collectJavaScriptFiles(directory, result = []) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === '.git') return
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) collectJavaScriptFiles(fullPath, result)
      else if (entry.name.endsWith('.js')) result.push(fullPath)
    })
    return result
  }

  function collectMediaFiles(directory, result = []) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) collectMediaFiles(fullPath, result)
      else if (/\.(png|jpe?g|gif|bmp|webp|mp3|wav|aac|m4a)$/i.test(entry.name)) result.push(fullPath)
    })
    return result
  }

  function collectFiles(directory, result = []) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === '.git') return
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) collectFiles(fullPath, result)
      else result.push(fullPath)
    })
    return result
  }

  function normalizeRelativePath(file) {
    return path.relative(root, file).replace(/\\/g, '/')
  }

  function isPackageIgnored(relativePath, ignoreRules) {
    return ignoreRules.some((item) => (
      item.type === 'folder'
        ? relativePath === item.value || relativePath.startsWith(`${item.value}/`)
        : relativePath === item.value
    ))
  }

  function getEffectivePackageFiles(projectConfig) {
    const ignoreRules = projectConfig.packOptions?.ignore || []
    return collectFiles(root).filter((file) => !isPackageIgnored(normalizeRelativePath(file), ignoreRules))
  }

  function formatKiB(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }

  function findSensitiveApiCalls(files) {
    const matches = []
    files.filter((file) => path.extname(file).toLowerCase() === '.js').forEach((file) => {
      const source = fs.readFileSync(file, 'utf8')
      SENSITIVE_WECHAT_APIS.forEach(({ category, apis }) => {
        apis.forEach((api) => {
          const pattern = new RegExp(
            `\\bwx\\s*(?:\\?\\.\\s*${api}\\b|\\.\\s*${api}\\b|\\[\\s*['\"]${api}['\"]\\s*\\])\\s*\\(`,
            'g',
          )
          let match
          while ((match = pattern.exec(source))) {
            matches.push({
              api: `wx.${api}`,
              category,
              file: normalizeRelativePath(file),
              line: source.slice(0, match.index).split(/\r?\n/).length,
            })
          }
        })
      })
    })
    return matches
  }

  function checkReleasePackageGates() {
    const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
    const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
    assert.strictEqual(appConfig.darkmode, true, 'app.json 未开启系统深色模式')
    assert.strictEqual(appConfig.themeLocation, 'theme.json', 'app.json 未配置主题文件')
    const themeConfig = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'))
    const themeKeys = ['navBgColor', 'navTextColor', 'bgTextStyle', 'pageBgColor', 'tabBgColor', 'tabTextColor', 'tabSelectedColor', 'tabBorderColor', 'exploreIcon', 'exploreSelectedIcon', 'toolsIcon', 'toolsSelectedIcon', 'projectsIcon', 'projectsSelectedIcon']
    for (const mode of ['light', 'dark']) {
      assert(themeConfig[mode] && themeKeys.every((key) => themeConfig[mode][key]), `theme.json 缺少 ${mode} 主题键`)
    }
    assert.strictEqual(themeConfig.light.pageBgColor, '#f2f2f7')
    assert.strictEqual(themeConfig.dark.pageBgColor, '#000000')
    assert.strictEqual(themeConfig.light.bgTextStyle, 'dark')
    assert.strictEqual(themeConfig.dark.bgTextStyle, 'light')
    assert.strictEqual(themeConfig.light.navTextColor, 'black')
    assert.strictEqual(themeConfig.dark.navTextColor, 'white')
    assert.strictEqual(themeConfig.light.tabTextColor, '#636366')
    assert.strictEqual(themeConfig.light.tabSelectedColor, '#0066cc')
    assert.strictEqual(themeConfig.dark.tabTextColor, '#aeaeb2')
    assert.strictEqual(themeConfig.dark.tabSelectedColor, '#0a84ff')
    const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
    assert(/--theme-accent-text:\s*#005eb8/.test(appWxss) && /--theme-primary-fill:\s*#0066cc/.test(appWxss),
      '浅色主题缺少增强文字色或主按钮填充色')
    const appDarkCss = appWxss.slice(appWxss.indexOf('@media (prefers-color-scheme: dark)'))
    assert(/--theme-accent-text:\s*#8ac8ff/.test(appDarkCss) && /--theme-primary-fill:\s*#0066cc/.test(appDarkCss),
      '深色主题缺少增强文字色或主按钮填充色')
    assert(/--theme-text-secondary:\s*#5f5f64/.test(appWxss) && /--theme-text-tertiary:\s*#6e6e73/.test(appWxss),
      '浅色主题辅助文字色对比度未达标')
    assert(/--theme-success:\s*#1f744c/.test(appWxss), '浅色成功状态色对比度未达标')
    const secondThemePages = [
      'pages/limiter/limiter.wxss', 'pages/spl/spl.wxss', 'pages/cable/cable.wxss',
      'pages/camera/camera.wxss', 'pages/led-screen/led-screen.wxss',
      'pages/gain-structure/gain-structure.wxss', 'pages/products/library.wxss',
      'pages/products/detail.wxss', 'pages/knowledge/detail.wxss',
      'pages/dmx-address/dmx-address.wxss', 'pages/dmx-address/channel-guide.wxss',
      'pages/control-protocol/index.wxss', 'pages/control-protocol/detail.wxss',
    ]
    secondThemePages.forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      const darkStart = Math.min(...[source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
      const darkCss = darkStart >= 0 ? source.slice(darkStart) : ''
      const hasDarkThemeToken = file === 'pages/gain-structure/gain-structure.wxss'
        ? darkCss.includes('var(--theme-control)') && darkCss.includes('var(--theme-success)')
        : file === 'pages/dmx-address/dmx-address.wxss'
          ? /--text:\s*#fff\b/.test(darkCss) && /--control:\s*#1c1c1e\b/.test(darkCss)
        : darkCss.includes('var(--theme-text)') || darkCss.includes('var(--tx)')
      assert(source.startsWith('@import "../../styles/theme-page-shared.wxss"') && (source.match(/@import "\.\.\/\.\.\/styles\/theme-page-shared\.wxss"/g) || []).length === 1 && (file === 'pages/knowledge/detail.wxss' || hasDarkThemeToken),
        `${file} 未接入第二批深色主题规则`)
      if (file === 'pages/knowledge/detail.wxss') {
        assert(/\.article-lead\{[^}]*color:var\(--ts\)[^}]*font-size:30rpx/.test(source) && /\.article-section\{[^}]*border-top:1rpx solid var\(--td\)/.test(source),
          `${file} 正文未使用主题辅助文字色或章节分隔线`)
      }
    })
    const darkRequiredByPage = {
      'pages/limiter/limiter.wxss': ['.field-control', '.output-status-invalid'],
      'pages/spl/spl.wxss': ['.settings-card .speaker-field .equipment-value', '.settings-card .speaker-field .equipment-model'],
      'pages/cable/cable.wxss': ['.mode-tab.mode-tab-active .mode-label', '.cable-spec'],
      'pages/camera/camera.wxss': ['.selector-model.selector-model'],
      'pages/gain-structure/gain-structure.wxss': ['.result-card', '.status-chip', '.sheet-panel', '.project-row-selected'],
      'pages/led-screen/led-screen.wxss': [],
      'pages/products/library.wxss': [],
      'pages/products/detail.wxss': [],
      'pages/dmx-address/dmx-address.wxss': ['.address-chip', '.fixture-control-box', '.quantity-box input', '.fixture-name'],
      'pages/dmx-address/channel-guide.wxss': ['.product-name.product-name', '.mode.mode-active'],
    }
    const darkCssFromFirstMedia = (source) => {
      const starts = [source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0)
      return source.slice(Math.min(...starts)).replace(/\s+/g, '')
    }
    const assertDarkDeclaration = (source, selector, declaration, message) => {
      const darkCss = darkCssFromFirstMedia(source)
      const selectorText = selector.replace(/\s+/g, '')
      const declarationText = declaration.replace(/\s+/g, '')
      let selectorIndex = darkCss.indexOf(selectorText)
      let matched = false
      while (selectorIndex >= 0) {
        const blockStart = darkCss.indexOf('{', selectorIndex)
        const blockEnd = darkCss.indexOf('}', blockStart)
        const body = blockStart >= 0 && blockEnd > blockStart ? darkCss.slice(blockStart + 1, blockEnd) : ''
        const declarationVariants = [declarationText]
        Object.entries(themeAliasMap).forEach(([longName, shortName]) => {
          if (declarationText.includes(longName)) declarationVariants.push(declarationText.replace(longName, shortName))
        })
        if (declarationVariants.some((value) => body.includes(value))) {
          matched = true
          break
        }
        selectorIndex = darkCss.indexOf(selectorText, selectorIndex + selectorText.length)
      }
      assert(matched, message)
    }
    Object.entries(darkRequiredByPage).forEach(([file, selectors]) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      const darkStart = Math.min(...[source.indexOf('@media (prefers-color-scheme: dark)'), source.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
      const darkCss = source.slice(darkStart)
      selectors.forEach((selector) => assert(darkCss.includes(selector), `${file} dark 规则缺少真实选择器 ${selector}`))
    })
    const wxssFiles = []
    const collectWxss = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === 'tmp') return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) collectWxss(full)
      else if (entry.isFile() && entry.name.endsWith('.wxss')) wxssFiles.push(full)
    })
    // Archived verification snapshots are outside the production page source set.
    collectWxss(path.join(root, 'pages'))
    const sharedImportFiles = wxssFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('@import "../../styles/theme-page-shared.wxss"'))
    const expectedSharedThemePages = secondThemePages.concat('pages/audio-wiring/index.wxss', 'pages/project-wiring/index.wxss', 'pages/records/report.wxss')
    assert.strictEqual(sharedImportFiles.length, expectedSharedThemePages.length, '共享主题导入集合必须严格等于第二批页面与布线分包页面')
    assert(expectedSharedThemePages.every((file) => sharedImportFiles.includes(path.join(root, file))), '共享主题导入集合与预期页面不一致')
    const secondThemeRoots = {
      'pages/limiter/limiter.wxss': '.page-root, .page-scroll',
      'pages/spl/spl.wxss': '.page-root, .page-scroll',
      'pages/cable/cable.wxss': '.page-root, .page-scroll',
      'pages/camera/camera.wxss': '.page-root, .page-scroll',
      'pages/led-screen/led-screen.wxss': '.page-root, .page-scroll',
      'pages/gain-structure/gain-structure.wxss': '.page-root',
      'pages/products/library.wxss': '.page-scroll',
      'pages/products/detail.wxss': '.page-scroll',
      'pages/knowledge/detail.wxss': '.knowledge-scroll',
      'pages/dmx-address/dmx-address.wxss': '.page-root',
      'pages/dmx-address/channel-guide.wxss': '.page',
    }
    Object.entries(secondThemeRoots).forEach(([file, rootSelector]) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      assert(source.replace(/\s+/g, '').includes(rootSelector.replace(/\s+/g, '')), `${file} 缺少真实页面根类覆盖`)
    })
    const recordsTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxss'), 'utf8')
    const recordsWxmlTheme = fs.readFileSync(path.join(root, 'pages/records/project.wxml'), 'utf8')
    const projectHomeImport = '@import "../../styles/homepage.wxss"'
    const projectDarkStart = Math.min(...[recordsTheme.indexOf('@media (prefers-color-scheme: dark)'), recordsTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const projectDarkCss = recordsTheme.slice(projectDarkStart)
    const appThemeForProject = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
    const appDarkStartForProject = appThemeForProject.indexOf('@media (prefers-color-scheme: dark)')
    const appDarkThemeForProject = appThemeForProject.slice(appDarkStartForProject)
    assert(recordsTheme.startsWith(`${projectHomeImport};`)
      && (recordsTheme.match(/@import "\.\.\/\.\.\/styles\/homepage\.wxss"/g) || []).length === 1
      && /\.interior-root\{[^}]*background:var\(--theme-page-bg\)[^}]*color:var\(--theme-text\)/.test(recordsTheme)
      && projectDarkCss.includes('.interior-root,.interior-scroll,.interior-content{background:#000}')
      && projectDarkCss.includes('background:var(--theme-surface)')
      && projectDarkCss.includes('background:var(--theme-control)')
      && /--theme-page-bg:\s*#000/.test(appDarkThemeForProject)
      && /--theme-surface:\s*#1c1c1e/.test(appDarkThemeForProject)
      && /--theme-control:\s*#2c2c2e/.test(appDarkThemeForProject)
      && /--theme-text:\s*#fff/.test(appDarkThemeForProject),
    '项目内部页需使用首页共享样式与有效的全局深色主题变量')
    assert(/\.interior-filter-row \.home-chip-active\{[^}]*background:var\(--theme-primary-fill\)[^}]*color:#fff/.test(projectDarkCss),
      '项目内部页深色筛选选中项需保持蓝底白字')
    assert(/\.interior-menu-button\{[^}]*width:44px[^}]*max-width:44px[^}]*flex:0 0 44px/.test(recordsTheme)
      && /\.interior-report-button\{[^}]*width:100%;[^}]*max-width:none;[^}]*flex:1 1 100%/.test(recordsTheme),
    '项目管理和报告按钮需保持可控原生触区宽度')
    assert(recordsTheme.includes('.interior-root{height:100vh;background:var(--theme-page-bg);color:var(--theme-text)}')
      && recordsTheme.includes('.interior-item{') && recordsTheme.includes('background:var(--theme-surface)')
      && recordsWxmlTheme.includes('class="interior-project-title"')
      && recordsWxmlTheme.includes('class="interior-report-button" disabled="{{workspaceError}}" bindtap="openProjectReport"')
      && recordsWxmlTheme.includes('class="interior-search-input"')
      && recordsWxmlTheme.includes('class="interior-item'),
    '项目内部页需使用首页共享样式、全局主题变量及当前真实结构')
    assert(!recordsWxmlTheme.includes('interior-add-button') && !recordsWxmlTheme.includes('interior-bottom-bar'),
      '项目详情不再显示添加内容固定底栏')
    const dmxTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/dmx-address.wxss'), 'utf8')
    const channelGuideTheme = fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8')
    const sharedTheme = fs.readFileSync(path.join(root, 'styles/theme-page-shared.wxss'), 'utf8')
    ;['.fixture-search-sheet', '.fixture-channel-guide-sheet', '.floating-card', '.pending-sheet', '.save-project-sheet', '.result-report-preview-sheet']
      .forEach((selector) => assert(dmxTheme.includes(selector), `DMX 页面缺少真实弹层覆盖：${selector}`))
    assert(sharedTheme.includes('.picker-value.picker-value') && sharedTheme.includes('.selector-model.selector-model') && sharedTheme.includes('.metric.metric') &&
      sharedTheme.includes('.selector-search.selector-search') && sharedTheme.includes('.input-shell.input-shell') &&
      sharedTheme.includes('.status-chip.status-chip-good'), '共享主题缺少明确控件与成功态覆盖')
    assert(fs.readFileSync(path.join(root, 'pages/dmx-address/channel-guide.wxss'), 'utf8').includes('.range text:first-child') &&
      recordsWxmlTheme.includes('interior-report-button') && dmxTheme.includes('.fixture-search-box input'),
    '第二批页面内部控件深色覆盖不完整')
    const recordsDarkStart = Math.min(...[recordsTheme.indexOf('@media (prefers-color-scheme: dark)'), recordsTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const dmxDarkStart = Math.min(...[dmxTheme.indexOf('@media (prefers-color-scheme: dark)'), dmxTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const hasRecordThemeClasses = [...recordsWxmlTheme.matchAll(/<view\b([^>]*)>/g)].some((match) => {
      const classAttribute = /\bclass="([^"]+)"/.exec(match[1])
      const classes = classAttribute ? classAttribute[1].split(/\s+/) : []
      return classes.includes('interior-item') && classes.includes('interior-record-item')
    })
    assert(recordsTheme.slice(recordsDarkStart).includes('.interior-project-title') &&
      recordsTheme.slice(recordsDarkStart).includes('background:var(--theme-control)') &&
      recordsTheme.slice(recordsDarkStart).includes('background:var(--theme-surface)') &&
      hasRecordThemeClasses &&
      dmxTheme.includes('.fixture-search-row-selected{background:var(--control)') &&
      dmxTheme.includes('.fixture-result-model{color:var(--text)') && dmxTheme.includes('.fixture-channel-guide-detail-ranges') &&
      dmxTheme.slice(dmxDarkStart).includes('.address-chip{background:var(--group-tint)'), '深色主题内部真实结构覆盖不完整')
    assert(sharedTheme.includes('page .field-label.field-label') && sharedTheme.includes('page .input-wrap.input-wrap') && sharedTheme.includes('input::placeholder') && sharedTheme.includes('.selector-panel') && sharedTheme.includes('button[disabled]'),
      '第二批共享主题规则未覆盖输入、占位符、选择器和禁用态')
    const guideDarkStart = Math.min(...[channelGuideTheme.indexOf('@media (prefers-color-scheme: dark)'), channelGuideTheme.indexOf('@media (prefers-color-scheme:dark)')].filter((index) => index >= 0))
    const guideDark = channelGuideTheme.slice(guideDarkStart)
    assert(guideDark.includes('.mode.mode-active') && !/\.product-name\.product-name[^}]*background\s*:\s*var\(--theme-accent-soft\)/.test(guideDark), '通道页非激活文字规则不得携带激活背景')
    assertDarkDeclaration(dmxTheme, '.page-root', 'background:#000', 'DMX 深色页面根背景应为预览图纯黑色')
    assertDarkDeclaration(dmxTheme, '.page-root', '--surface:#111', 'DMX 深色弹层缺少表面背景变量')
    assertDarkDeclaration(dmxTheme, '.page-root', '--control:#1c1c1e', 'DMX 深色输入缺少控件背景变量')
    assertDarkDeclaration(dmxTheme, '.page-root', '--text:#fff', 'DMX 深色主文字缺少白色变量')
    assertDarkDeclaration(dmxTheme, '.quantity-box input', 'color:#fff', 'DMX 数量输入缺少深色可读文字')
    const dmxBaseCss = dmxTheme.slice(0, dmxDarkStart)
    const dmxBaseDeclarations = (selector) => [...dmxBaseCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1].split(',').map((value) => value.trim()).includes(selector))
      .map((match) => match[2].replace(/\s+/g, '')).join(';')
    assert(dmxBaseDeclarations('.page-scroll').includes('background:var(--page-bg)'), 'DMX 滚动页面未继承根主题背景')
    ;['.fixture-search-sheet', '.fixture-channel-guide-sheet', '.floating-card', '.pending-sheet', '.save-project-sheet', '.result-report-preview-sheet']
      .forEach((selector) => assert(dmxBaseDeclarations(selector).includes('background:var(--surface)') &&
        (dmxBaseDeclarations(selector).includes('color:var(--text)') || selector === '.floating-card'),
      `DMX 实际弹层未继承深色表面与文字：${selector}`))
    assert(dmxBaseDeclarations('.fixture-search-box').includes('background:var(--control)') &&
      dmxBaseDeclarations('.fixture-search-box input').includes('color:var(--text)') &&
      dmxBaseDeclarations('.project-name-input').includes('background:var(--control)') &&
      dmxBaseDeclarations('.project-name-input').includes('color:var(--text)'), 'DMX 搜索与项目输入缺少主题继承')
    const knowledgeTheme = fs.readFileSync(path.join(root, 'pages/knowledge/detail.wxss'), 'utf8')
    assert(/\.article-lead\{[^}]*padding:0[^}]*color:var\(--ts\)/.test(knowledgeTheme), '知识详情引导语应为透明纸面正文并使用主题辅助文字色')
    assert(/\.section-paragraph\{[^}]*color:var\(--ts\)[^}]*font-size:29rpx/.test(knowledgeTheme), '知识详情正文缺少可读的主题辅助文字色')
    assert(/\.knowledge-error-button\.knowledge-error-button\{[^}]*background:var\(--tp\)[^}]*color:#fff/.test(knowledgeTheme), '知识详情错误页按钮缺少蓝底白字层叠保护')
    const splTheme = fs.readFileSync(path.join(root, 'pages/spl/spl.wxss'), 'utf8')
    assertDarkDeclaration(splTheme, '.distance-input-wrap', 'background:var(--theme-control)', 'SPL 距离输入壳缺少深色控件背景')
    assertDarkDeclaration(splTheme, '.settings-card .compact-grid .field-label.field-label', 'color:var(--theme-text-secondary)', 'SPL 紧凑输入标签缺少深色辅助文字色')
    assertDarkDeclaration(splTheme, '.reference-title.reference-title', 'color:var(--theme-text)', 'SPL 参考标题缺少深色主文字色')
    assertDarkDeclaration(splTheme, '.meeting-text', 'color:var(--theme-text-secondary)', 'SPL 参考说明缺少深色辅助文字色')
    assertDarkDeclaration(splTheme, '.distance-value', 'color:var(--theme-text-secondary)', 'SPL 距离数值缺少深色辅助文字色')
    assertDarkDeclaration(sharedTheme, 'page .warning-text.warning-text', 'color:var(--theme-warning)', '共享警告正文未使用 warning 语义色')
    assert(!recordsTheme.includes('.interior-comparison-grid') && !recordsTheme.includes('.interior-comparison-row'),
      '项目详情不再保留计算记录比较表样式')
    ;['pages/dmx-layout/dmx-layout.wxss']
      .forEach((file) => assert(!fs.readFileSync(path.join(root, file), 'utf8').includes('theme-page-shared'), `${file} 不得导入第二批共享主题`))
    ;['pages/led-screen/led-screen.json', 'pages/gain-structure/gain-structure.json', 'pages/products/library.json',
      'pages/products/detail.json', 'pages/dmx-address/dmx-address.json', 'pages/dmx-address/channel-guide.json',
      'pages/dmx-layout/dmx-layout.json']
      .forEach((file) => {
        const source = fs.readFileSync(path.join(root, file), 'utf8')
        assert(!source.includes('navigationBarBackgroundColor') && !source.includes('navigationBarTextStyle'),
          `${file} 不得写死导航栏颜色`)
      })
    assert.deepStrictEqual(
      Object.fromEntries(['navigationBarTextStyle', 'navigationBarBackgroundColor', 'backgroundColor', 'backgroundTextStyle'].map((key) => [key, appConfig.window[key]])),
      { navigationBarTextStyle: '@navTextColor', navigationBarBackgroundColor: '@navBgColor', backgroundColor: '@pageBgColor', backgroundTextStyle: '@bgTextStyle' },
    )
    assert.deepStrictEqual(
      Object.fromEntries(['color', 'selectedColor', 'backgroundColor', 'borderStyle'].map((key) => [key, appConfig.tabBar[key]])),
      { color: '@tabTextColor', selectedColor: '@tabSelectedColor', backgroundColor: '@tabBgColor', borderStyle: '@tabBorderColor' },
    )
    const iconKeys = ['exploreIcon', 'exploreSelectedIcon', 'toolsIcon', 'toolsSelectedIcon', 'projectsIcon', 'projectsSelectedIcon']
    for (const mode of ['light', 'dark']) iconKeys.forEach((key) => assert(fs.existsSync(path.join(root, themeConfig[mode][key])), `${mode} 主题图标缺失：${key}`))
    for (const item of appConfig.tabBar.list) {
      assert(item.iconPath.startsWith('@') && item.selectedIconPath.startsWith('@'), `${item.text}页签图标未使用主题变量`)
    }
    const layoutFactorySource = fs.readFileSync(path.join(root, 'pages/dmx-layout/page-factory.js'), 'utf8')
    const layoutRendererSource = fs.readFileSync(path.join(root, 'pages/dmx-layout/layout-renderer.js'), 'utf8')
    const layoutCanvasSource = `${layoutFactorySource}\n${layoutRendererSource}`
    assert(layoutCanvasSource.includes('CANVAS_THEMES') && layoutCanvasSource.includes('getCanvasTheme') &&
      layoutFactorySource.includes('wx.onThemeChange') && layoutFactorySource.includes('wx.offThemeChange') &&
      layoutFactorySource.includes('this.clearImage()') && layoutRendererSource.includes('theme.background') &&
      layoutRendererSource.includes('theme.stage'), '位置图 Canvas 缺少浅深色调色板或主题切换清图重绘机制')
    ;['pages/dmx-layout/dmx-layout.wxss'].forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      const layoutDarkCss = source.slice(source.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)).replace(/\s+/g, '')
      assert(/@media\s*\(prefers-color-scheme:\s*dark\)/.test(source) &&
        ['page-bg', 'surface', 'control'].every((token) => new RegExp(`var\\(\\s*--theme-${token}(?:\\s*,[^)]+)?\\s*\\)`).test(source)) &&
        /--theme-page-bg:\s*#000\b/.test(layoutDarkCss) && /--theme-surface:\s*#1c1c1e\b/.test(layoutDarkCss) &&
        /--theme-control:\s*#2c2c2e\b/.test(layoutDarkCss) && /--theme-text:\s*#fff\b/.test(layoutDarkCss) &&
        /\.settings-apply,\.reduction-confirm,\.export-share\{background:#007aff\}/.test(source), `${file} 缺少核心深色层级覆盖`)
    })
    const packageFiles = getEffectivePackageFiles(projectConfig)
    const draftProtocolGate = evaluateDraftProtocolPackageGate(
      packageFiles.map(normalizeRelativePath),
    )
    assert(draftProtocolGate.allowed,
      `拒绝发布：包内仍含未正式收录的控制协议开发样本/照片：${draftProtocolGate.resources.join('、')}。开发样本只能存放在 tests/fixtures 中。`)
    const packageGroups = getPackageGroups(packageFiles, appConfig)
    const subPackageRoots = (appConfig.subPackages || []).map((subPackage) => subPackage.root)
    const mainPackage = packageGroups.find((group) => !group.root)
    const mainPackageBytes = mainPackage.files.reduce((total, file) => total + fs.statSync(file).size, 0)
    const crossPackageRequires = findSubPackageRequires(mainPackage.files, subPackageRoots)
    assert.strictEqual(crossPackageRequires.length, 0,
      `主包 JS 不得 require 分包资源：${crossPackageRequires.map((item) => `${item.file} -> ${item.request}`).join('；')}`)
    const basisSubPackage = (appConfig.subPackages || []).find((subPackage) => subPackage.root === 'pages/basis')
    assert(basisSubPackage?.pages?.includes('detail'), '依据详情页未注册为独立分包')
    assert(!appConfig.pages.includes('pages/basis/detail'), '依据详情页仍位于主包 pages 中')
    assert(fs.existsSync(path.join(root, 'pages/basis/assets/cable.png')))
    assert(!fs.existsSync(path.join(root, 'assets/basis')), '依据详情图仍位于主包 assets')
    const dmxSubPackage = (appConfig.subPackages || []).find((subPackage) => subPackage.root === 'pages/dmx-address')
    assert(dmxSubPackage?.pages?.includes('dmx-address'), 'DMX 地址页未注册为独立分包')
    assert(dmxSubPackage?.pages?.includes('channel-guide'), 'DMX 通道资料页未注册为独立分包')
    assert(!appConfig.pages.includes('pages/dmx-address/dmx-address'), 'DMX 地址页仍在主包 pages 中')
    assert(fs.existsSync(path.join(root, 'pages/dmx-address/data/stage-lighting-channels.js')))
    assert(fs.existsSync(path.join(root, 'pages/dmx-address/utils/dmx-channel-guide.js')))
    assert(!fs.existsSync(path.join(root, 'data/stage-lighting-channels.js')), '详细灯具通道资料仍位于主包 data')
    assert(!fs.existsSync(path.join(root, 'utils/dmx-channel-guide.js')), 'DMX 通道工具仍位于主包 utils')
    const bytesByExtension = packageFiles.reduce((totals, file) => {
      const extension = path.extname(file).toLowerCase()
      totals[extension] = (totals[extension] || 0) + fs.statSync(file).size
      return totals
    }, {})
    const totalBytes = packageFiles.reduce((total, file) => total + fs.statSync(file).size, 0)
    const javascriptFiles = packageFiles
      .filter((file) => path.extname(file).toLowerCase() === '.js')
      .map((file) => ({ file, bytes: fs.statSync(file).size }))
      .sort((left, right) => right.bytes - left.bytes)
    const largestJavaScript = javascriptFiles[0] || { file: '', bytes: 0 }

    assert(
      totalBytes <= PACKAGE_BUDGETS.total,
      `有效正式包超过 ${formatKiB(PACKAGE_BUDGETS.total)}：${formatKiB(totalBytes)}`,
    )
    assert(
      mainPackageBytes <= PACKAGE_BUDGETS.mainTotal,
      `主包源码资源超过 ${formatKiB(PACKAGE_BUDGETS.mainTotal)}：${formatKiB(mainPackageBytes)}`,
    )
    ;['.wxss', '.wxml'].forEach((extension) => {
      const actual = bytesByExtension[extension] || 0
      assert(
        actual <= PACKAGE_BUDGETS[extension],
        `有效正式包 ${extension.slice(1).toUpperCase()} 超过 ${formatKiB(PACKAGE_BUDGETS[extension])}：${formatKiB(actual)}`,
      )
    })
    assert(
      largestJavaScript.bytes <= PACKAGE_BUDGETS.singleJavaScript,
      `单个 JS 超过 ${formatKiB(PACKAGE_BUDGETS.singleJavaScript)}：${normalizeRelativePath(largestJavaScript.file)} ${formatKiB(largestJavaScript.bytes)}`,
    )
    packageGroups.forEach((group) => {
      const javascriptBytes = group.files
        .filter((file) => path.extname(file).toLowerCase() === '.js')
        .reduce((total, file) => total + fs.statSync(file).size, 0)
      const javascriptBudget = group.root
        ? PACKAGE_BUDGETS.subPackageJavaScript
        : PACKAGE_BUDGETS.mainJavaScript
      assert(
        javascriptBytes <= javascriptBudget,
        `${group.name} JS 超过 ${formatKiB(javascriptBudget)}：${formatKiB(javascriptBytes)}`,
      )
    })

    assert.strictEqual(new Set(appConfig.pages).size, appConfig.pages.length, 'app.json 页面清单存在重复路径')
    const registeredPages = getRegisteredPagePaths(appConfig)
    assert.strictEqual(new Set(registeredPages).size, registeredPages.length, '主包与分包页面清单存在重复路径')
    assert.deepStrictEqual([...registeredPages].sort(), [...EXPECTED_APP_PAGES].sort(), '主包与分包页面清单与发布基线不一致')
    registeredPages.forEach((pagePath) => {
      ;['.js', '.json', '.wxml', '.wxss'].forEach((extension) => {
        const file = path.join(root, `${pagePath}${extension}`)
        assert(fs.existsSync(file), `页面缺少 ${extension} 文件：${pagePath}`)
        if (extension === '.json') JSON.parse(fs.readFileSync(file, 'utf8'))
      })
    })
    const tabPages = (appConfig.tabBar?.list || []).map((item) => item.pagePath)
    assert.strictEqual(new Set(tabPages).size, tabPages.length, 'tabBar 页面存在重复路径')
    tabPages.forEach((pagePath) => assert(registeredPages.includes(pagePath), `tabBar 页面未注册：${pagePath}`))

    const sensitiveCalls = findSensitiveApiCalls(packageFiles)
    assert.strictEqual(
      sensitiveCalls.length,
      0,
      `检测到需人工审核的敏感 API：\n${sensitiveCalls.map((item) => (
        `- ${item.category} ${item.api} @ ${item.file}:${item.line}`
      )).join('\n')}`,
    )

    const javascriptByPackage = packageGroups.map((group) => {
      const bytes = group.files
        .filter((file) => path.extname(file).toLowerCase() === '.js')
        .reduce((total, file) => total + fs.statSync(file).size, 0)
      const budget = group.root
        ? PACKAGE_BUDGETS.subPackageJavaScript
        : PACKAGE_BUDGETS.mainJavaScript
      return `${group.name} JS ${formatKiB(bytes)} / ${formatKiB(budget)}`
    }).join('；')
    console.log(
      `发布包门禁：总计 ${formatKiB(totalBytes)} / ${formatKiB(PACKAGE_BUDGETS.total)}；`
      + `主包源码资源 ${formatKiB(mainPackageBytes)} / ${formatKiB(PACKAGE_BUDGETS.mainTotal)}（非微信编译包实测值）；`
      + `${javascriptByPackage}；`
      + `WXSS ${formatKiB(bytesByExtension['.wxss'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxss'])}；`
      + `WXML ${formatKiB(bytesByExtension['.wxml'] || 0)} / ${formatKiB(PACKAGE_BUDGETS['.wxml'])}；`
      + `最大 JS ${normalizeRelativePath(largestJavaScript.file)} ${formatKiB(largestJavaScript.bytes)} / ${formatKiB(PACKAGE_BUDGETS.singleJavaScript)}。`,
    )
    console.log(`页面清单门禁：${appConfig.pages.length} 个主包页面、${registeredPages.length - appConfig.pages.length} 个分包页面、${tabPages.length} 个 tabBar 页面均完整。`)
    console.log('敏感 API 静态扫描：0 命中；用户触发的剪贴板、相册保存、震动与 Canvas API 保持允许。')
  }

  function checkSyntax() {
    collectJavaScriptFiles(root).forEach((file) => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }))
  }

  return {
    PACKAGE_BUDGETS,
    EXPECTED_APP_PAGES,
    SENSITIVE_WECHAT_APIS,
    getRegisteredPagePaths,
    getPackageGroups,
    findSubPackageRequires,
    collectJavaScriptFiles,
    collectMediaFiles,
    collectFiles,
    normalizeRelativePath,
    isPackageIgnored,
    getEffectivePackageFiles,
    formatKiB,
    findSensitiveApiCalls,
    checkReleasePackageGates,
    checkSyntax,
  }
}

module.exports = { createPackageChecks }
