const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
new Function(html.split('<script>')[1].split('</script>')[0]);
assert(!html.includes('\uFFFD'), 'UTF-8 replacement character');
const server = http.createServer((req,res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(html);
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2026-10-19T12:00:00Z')});
    await page.goto(url);
    assert.equal(await page.locator('#weekSelect option').count(),16);
    assert.equal(await page.locator('#cycleTableBody tr').count(),16);
    assert.equal(await page.locator('.charts svg').count(),2);
    assert.equal(await page.locator('.supp-table input').count(),42);
    assert.match(await page.locator('#pctDaysCount').innerText(),/^1 дн/);
    assert.equal(await page.locator('#suppDateInput').inputValue(),'2026-10-19');
    assert.equal(await page.evaluate(()=>protectedThrough()),1);
    const dates = [
      ['2026-10-17','before',0,null,-1],['2026-10-18','before',0,null,0],
      ['2026-11-07','before',0,null,20],['2026-11-08','active',1,50,21],
      ['2026-11-14','active',1,50,27],['2026-11-15','active',2,50,28],
      ['2026-11-21','active',2,50,34],['2026-11-22','active',3,25,35],
      ['2026-11-28','active',3,25,41],['2026-11-29','active',4,25,42],
      ['2026-12-05','active',4,25,48],['2026-12-06','after',0,null,49]
    ];
    for(const [date,stage,week,dose,since] of dates){
      const p=await page.evaluate(d=>pctForDate(d),date);
      assert.deepEqual([p.stage,p.week,p.dose,p.daysSince],[stage,week,dose,since],date);
    }
    console.log('PASS: UTF-8, 16 weeks, SVG charts, PCT boundary dates');

    await page.locator('[data-supp-key="2026-10-19_zinc"]').check();
    await page.reload();
    assert.equal(await page.locator('[data-supp-key="2026-10-19_zinc"]').isChecked(),true);
    await page.locator('#suppDateInput').fill('2026-11-23');
    await page.locator('#suppDateInput').dispatchEvent('change');
    await page.locator('[data-supp-key="2026-11-23_clomid"]').check();
    assert.match(await page.locator('[data-supp-key="2026-11-23_clomid"]').locator('..').innerText(),/25 мг/);
    await page.evaluate(()=>shiftSuppWeek(-7));
    assert.equal(await page.locator('[data-supp-key="2026-11-16_clomid"]').isChecked(),false);
    assert.match(await page.locator('[data-supp-key="2026-11-16_clomid"]').locator('..').innerText(),/50 мг/);
    await page.evaluate(()=>shiftSuppWeek(21));
    assert.equal(await page.locator('[data-supp-key="2026-12-07_clomid"]').isDisabled(),true);
    await page.locator('#suppDateInput').fill('2027-01-01');
    await page.locator('#suppDateInput').dispatchEvent('change');
    await page.locator('[data-supp-key="2027-01-01_creatine"]').check();
    assert.match(await page.locator('#suppRange').innerText(),/28\.12\.2026.*03\.01\.2027/);
    console.log('PASS: daily supplement persistence, dose by date, year boundary');

    await page.locator('#factRIR').fill('0');
    await page.locator('#factShoulder').fill('0');
    await page.locator('#factShoulderRight').fill('3');
    const attack='100 кг × 15 " <img src=x onerror="window.injected=true">';
    await page.locator('#d1FactInput').fill(attack);
    await page.reload();
    assert.equal(await page.locator('#d1FactInput').inputValue(),attack);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    const payload=await page.evaluate(()=>weeklyPayload());
    assert.equal(payload.fact.rir,0);assert.equal(payload.fact.shoulderLeft,0);assert.equal(payload.fact.shoulderRight,3);
    assert.equal(payload.plan.w,1);assert.equal(payload.suppChecks['2026-10-19_zinc'],true);
    assert(payload.biochemistry.baseline);
    const before=await page.evaluate(()=>({weeks:JSON.stringify(state.weeks),supp:JSON.stringify(state.suppChecks),old:getWeekPlan(1).d1_main}));
    await page.evaluate(()=>{document.getElementById('weekSelect').value=16;changeWeek();});
    assert.equal(await page.evaluate(()=>protectedThrough()),1,'navigation must not protect future weeks');
    const patch={schema:'metajhim.coach-patch.v1',plan:[{w:1,d1_main:'DO NOT CHANGE'},{w:2,d1_main:'107.5 кг: 4×6 (RIR 2)'}],weeks:{1:{reps100:99}},suppChecks:{},lastInjectDate:'2030-01-01'};
    await page.evaluate(()=>openImportModal());
    await page.locator('#importJsonArea').fill(JSON.stringify(patch));
    await page.getByRole('button',{name:'Проверить патч',exact:true}).click();
    assert.match(await page.locator('#patchPreview').innerText(),/Пропущены недели: 1/);
    await page.locator('#applyPatchButton').click();
    const after=await page.evaluate(()=>({weeks:JSON.stringify(state.weeks),supp:JSON.stringify(state.suppChecks),old:getWeekPlan(1).d1_main,new:getWeekPlan(2).d1_main,date:state.lastInjectDate}));
    assert.equal(after.weeks,before.weeks);assert.equal(after.supp,before.supp);assert.equal(after.old,before.old);assert.match(after.new,/107.5/);assert.equal(after.date,'2026-10-18');
    assert.equal(await page.evaluate(()=>localStorage.getItem('metajhim_dmitry_v4')),null);
    console.log('PASS: safe coach patch, protected history and supplement marks, zero values, HTML escaping');

    const invalids=[{plan:[{w:17,d1_main:'x'}]},{plan:[{w:2,target100:-1}]},{plan:[{w:2,d1_main:'a'},{w:2,d1_main:'b'}]},{settings:{compDate:'2026-02-30'}},{plan:[{w:2,d1_main:'x'},{w:3,isDeload:'false'}]},JSON.parse('{"__proto__":{}}')];
    for(const invalid of invalids){const result=await page.evaluate(raw=>{const before=JSON.stringify(state);try{preparePatch(JSON.parse(raw));return false;}catch{return before===JSON.stringify(state);}},JSON.stringify(invalid));assert(result,JSON.stringify(invalid));}
    const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>exportJSON());const download=await downloadPromise;const saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(saved.schema,'metajhim.backup.v2');assert.equal(saved.customPlan.length,16);assert.equal(saved.suppChecks['2026-11-23_clomid'],true);
    await page.evaluate(()=>openImportModal());await page.locator('#importJsonArea').fill(JSON.stringify(saved));
    page.once('dialog',d=>d.accept());await page.evaluate(()=>restoreBackup());
    assert.equal(await page.evaluate(()=>state.suppChecks['2026-11-23_clomid']),true);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true}));
    await page.evaluate(()=>copyWeeklyReport());
    assert(await page.locator('#reportModal').isVisible());
    const report=await page.locator('#reportArea').inputValue();assert.equal(JSON.parse(report.split('\n').at(-1)).schema,'metajhim.weekly-report.v1');
    await page.locator('#reportModal button').click();
    console.log('PASS: atomic validation, archive round trip, clipboard fallback');

    // Simulate denied storage; a patch must not change the live plan.
    assert(await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('quota');};const before=JSON.stringify(state);const p=preparePatch({plan:[{w:3,d1_main:'DO NOT APPLY'}]});const ok=saveToStorage(p.next);Storage.prototype.setItem=original;return !ok&&before===JSON.stringify(state);}));
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>selectWeek(1));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results','mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(root,'test-results','desktop.png'),fullPage:true});
    console.log('PASS: storage failure protection, mobile layout');

    const legacy=await browser.newContext();const legacyPage=await legacy.newPage();
    await legacyPage.clock.install({time:new Date('2026-10-19T12:00:00Z')});
    await legacyPage.addInitScript(()=>localStorage.setItem('metajhim_dmitry_v4',JSON.stringify({version:4,targetReps:24,compDate:'2027-02-21',activeWeek:1,suppChecks:{'2026-10-19_zinc':true},customPlan:null,weeks:{1:{reps100:'16',shoulder:'0',d1_fact:'legacy'}}})));
    await legacyPage.goto(url);
    assert.equal(await legacyPage.evaluate(()=>state.weeks[1].shoulderLeft),'0');
    assert.equal(await legacyPage.locator('[data-supp-key="2026-10-19_zinc"]').isChecked(),true);
    await legacyPage.locator('#factShoulderRight').fill('0');
    assert.equal(await legacyPage.evaluate(()=>JSON.parse(localStorage.getItem('metajhim_dmitry_v2')).weeks[1].d1_fact),'legacy');
    const bad=await browser.newContext();const badPage=await bad.newPage();await badPage.addInitScript(()=>localStorage.setItem('metajhim_dmitry_v2','broken JSON'));await badPage.goto(url);
    assert(await badPage.locator('#storageWarning').isVisible());await badPage.locator('#factRIR').fill('1');assert.equal(await badPage.evaluate(()=>localStorage.getItem('metajhim_dmitry_v2')),'broken JSON');
    console.log('PASS: v4 migration, legacy shoulder migration, damaged-storage preservation');
    assert.deepEqual(errors,[]);
    console.log('ALL CHECKS PASSED');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
