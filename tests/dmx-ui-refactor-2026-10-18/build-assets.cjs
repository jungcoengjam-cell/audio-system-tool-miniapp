// Deployment-size encoding of the generated sprite; the original is retained.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const sharp = require('C:/Users/wxx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')
const original = 'C:/Users/wxx/.codex/generated_images/01a14ae2-45ed-76d1-aeba-1959deacbdd4/exec-5199a4bc-4afe-4b9c-b477-c171c2389a39.png'
const target = path.resolve(__dirname, '../../assets/lighting/fixture-types.png')
async function main() {
  fs.mkdirSync(path.dirname(target), {recursive:true})
  fs.mkdirSync(path.join(__dirname,'imagegen'), {recursive:true})
  fs.copyFileSync(original,path.join(__dirname,'imagegen/fixture-types-original.png'))
  await sharp(original).resize(768,256).png({palette:true,colours:128,effort:10}).toFile(target)
  const metadata=await sharp(target).metadata()
  if(metadata.width!==768||metadata.height!==256||!metadata.hasAlpha)throw Error('Sprite deployment encoding lost cell ratio/transparency')
  const result={tool:'built-in image_gen',source:original,target,metadata,bytes:fs.statSync(target).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),cells:['profile','soft','moving'],note:'Generic visual type illustrations; names/modes/addresses come from the verified catalog and calculation engine.'}
  fs.writeFileSync(path.join(__dirname,'imagegen/asset.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
