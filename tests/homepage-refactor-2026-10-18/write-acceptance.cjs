'use strict'
const fs=require('node:fs'),path=require('node:path')
const base=__dirname
const source=fs.readFileSync(path.join(base,'handoff/TuneBuddy_Homepage_Handoff/ACCEPTANCE_CHECKLIST.md'),'utf8')
const evidence={
 A:['baseline/hashes.json','evidence/scope-audit.json','evidence/handoff-integrity.json'],
 B:['navigation-basis-behavior.cjs','navigation-copy-source-map.md','evidence/browser/capture-summary.json','evidence/native/tools-200rpx-refreshed.png'],
 C:['projects-storage-recovery.cjs','projects-context-lifecycle.cjs','evidence/browser-workflows/summary.json','evidence/native/project-header-fixed.png'],
 D:['interior-context.test.cjs','interior-view.test.cjs','projects-context-lifecycle.cjs','evidence/native/guard-stay-rearmed.json','evidence/native/guard-discard-route.json'],
 E:['storage-adversarial.cjs','projects-storage-recovery.cjs','evidence/final-tests/summary.json'],
 F:['navigation-copy-source-map.md','navigation-basis-behavior.cjs','evidence/browser/basis-presentation/summary.json'],
 G:['report-completeness.cjs','report-save-ownership.cjs','evidence/browser-workflows/summary.json','evidence/native/report-preview-final.png'],
 H:['evidence/browser/capture-summary.json','evidence/browser-workflows/summary.json','evidence/native/project-header-fixed.png'],
 I:['evidence/final-tests/summary.json','ACCEPTANCE.md'],
}
const untested={
 B4:'320/390/430宽度和模拟器已检查；操作系统文字缩放未验证。',
 B9:'线材编辑返回拦截已在原生模拟器+选择结果mock验证；全部路由及手机返回未完成。',
 C1:'卡片打开/切换与源码行为已检查；新建项目完整原生流程尚未完成。',
 D6:'页面保留筛选和scrollTop实现已审查，编辑后阅读位置的完整原生来回流程待验。',
 G3:'白色文档和底部分享/保存已检查；真实手机双指缩放未验证。',
 G9:'导出取消/失败/保存任务归属有回归覆盖；真实手机查看、授权、相册保存与分享菜单未验。',
 H3:'原生已检查部分卡片及按钮；全部触区的真实手机操作未完成。',
 H4:'开/关与减少动效样式已实现；真实手机动画连续性未验证。',
 H5:'返回取消后rearm和放弃退出已在模拟器验证；全量浮层/快速连点/多容器叠加仍待验。',
 H6:'源码和部分模拟器输入已检查；真实手机键盘、焦点、滚动和减少动效未验证。',
}
let section='',index=0;const items=[]
for(const line of source.split(/\r?\n/)){
 if(line.startsWith('## ')){section=line.slice(3,4);index=0}
 if(!line.startsWith('- [ ] '))continue
 const id=section+(++index)
 items.push({id,requirement:line.slice(6),status:untested[id]?'NOT TESTED':'PASS',level:'source / regression / browser or simulator evidence; never implies physical-device acceptance',evidence:evidence[section],note:untested[id]||'见对应源码、测试与证据。实际用户数据未被用于破坏性验收。'})
}
const result={at:new Date().toISOString(),overall:'INCOMPLETE',reason:'Full release gate fails; phone connection was confirmed by user but automation could not attach, so physical-device acceptance remains unperformed.',items}
fs.writeFileSync(path.join(base,'evidence/acceptance-checklist.json'),JSON.stringify(result,null,2))
console.log(`${items.length} checklist items; ${items.filter(x=>x.status==='NOT TESTED').length} NOT TESTED; overall INCOMPLETE`)
