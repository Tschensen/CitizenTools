"""Exercise period filtering and charts in WebView2 using an isolated profile."""
import argparse
import base64
import faulthandler
import json
from pathlib import Path
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import webview
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args()
    runtime = SoloRuntime(args.data_dir, port=0, lan=False)
    runtime.start(capture_enabled=False)
    pc = webview.create_window('Statistics verification', runtime.desktop_url, width=1280, height=720)
    device = webview.create_window('Independent statistics view', runtime.url.replace('127.0.0.1', 'localhost'), width=800, height=700)
    report = {'ok': False, 'checks': []}
    trace_file = (args.data_dir / 'test-trace.log').open('w', encoding='utf-8')
    faulthandler.dump_traceback_later(45, file=trace_file)
    original_evaluate = pc.evaluate_js
    def evaluate(script, *values, **options):
        trace_file.write('JS: ' + script[:200] + '\n')
        trace_file.flush()
        result = original_evaluate(script, *values, **options)
        trace_file.write('OK\n')
        trace_file.flush()
        return result
    pc.evaluate_js = evaluate

    def check():
        def until(window, script):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    if window.evaluate_js(script): return
                except Exception: pass
                time.sleep(.1)
            raise AssertionError(script)

        def expect(script, name):
            assert pc.evaluate_js(script), name
            report['checks'].append(name)

        def preset(value):
            pc.evaluate_js(f"statisticsPeriod.value={json.dumps(value)};statisticsPeriod.dispatchEvent(new Event('change'))")

        def screenshot(name, chart_only=False):
            from System import Action
            pc.native.Invoke(Action(lambda: pc.native.Activate()))
            time.sleep(.4)
            holder = {}
            control = pc.native.webview
            options = {'format': 'png'}
            if chart_only:
                options.update(captureBeyondViewport=True, clip=pc.evaluate_js("(() => {const r=document.querySelector('.statistics-trend-panel').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()"))
            control.Invoke(Action(lambda: holder.update(task=control.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', json.dumps(options)))))
            # Reading Result while pending can block callbacks at the Python/.NET
            # boundary. Yield the GIL while WebView2 completes the capture.
            capture_deadline = time.monotonic() + 10
            while not holder['task'].IsCompleted and time.monotonic() < capture_deadline:
                time.sleep(.05)
            if not holder['task'].IsCompleted:
                raise TimeoutError('WebView2 screenshot did not complete within 10 seconds')
            payload = json.loads(str(holder['task'].Result))
            (args.data_dir / (name + '.png')).write_bytes(base64.b64decode(payload['data']))

        try:
            for window in [pc, device]:
                until(window, "window.soloStartup?.phase==='ready' && soloSync.status.hydrated && soloSync.status.initialized && !soloSync.status.saving && !soloSync.status.pending")
                window.evaluate_js("document.querySelector('[data-module-target=statistics]').click()")
            expect("statisticsPeriod.value==='all' && statisticsTrend.textContent.includes('Keine datierten')", 'empty-first-start')
            expect("statisticsComparisonCaption.hidden && !document.querySelector('[data-statistics-comparison]')", 'all-time-without-invented-comparison')
            # Supply deterministic records directly to the statistics controller;
            # never persist them or read the user's real database.
            pc.evaluate_js("""(() => {
              const p=StatisticsPeriod, today=p.dateKey(new Date());
              window.statsToday=today;
              const profile=state.shipLibrary[0];
              state.fleet=[{id:'test-ship',shipId:profile.id,manufacturer:'Drake',model:'Test Ship',registration:'VERIFY',status:'active'}];
              state.missions=Array.from({length:8},(_,i)=>({id:'test-mission-'+i,status:'completed',createdAt:p.shiftDay(today,-20),completedAt:p.shiftDay(today,-i),payout:100000,customer:i===7?'Old customer':'Current customer',assignedFleetEntryId:'test-ship',loads:[{scu:10,deliveredAt:p.shiftDay(today,-i),pickup:'Everus Harbor',dropoff:'Area18'}],segments:[]}));
              state.ledgerEntries=Array.from({length:8},(_,i)=>({id:'income-'+i,missionId:'test-mission-'+i,bookedOn:p.shiftDay(today,-i),amountAuec:100000+i*20000,flow:'income',category:'Auftragserlös'}));
              state.ledgerEntries.push({id:'fuel',bookedOn:today,amountAuec:125000,flow:'expense',category:'Treibstoff',fleetEntryId:'test-ship'});
              state.ledgerEntries.push({id:'purchase',bookedOn:today,amountAuec:9999999,flow:'expense',category:'Schiffskauf'});
              state.stopHistory=[{id:'new-stop',completedAt:today,dropoff:'New stop',pickups:[],missionTitles:[],loadCount:1,scu:10},{id:'old-stop',completedAt:p.shiftDay(today,-10),dropoff:'Old stop',pickups:[],missionTitles:[],loadCount:1,scu:10}];
              statisticsController.render();
            })()""")
            expect("document.querySelector('[data-trend-total=income]').textContent==='1.360.000 aUEC' && document.querySelector('[data-trend-total=expense]').textContent==='125.000 aUEC'", 'all-time-booked-totals-exclude-ship-purchase')
            preset('week')
            expect("document.querySelectorAll('#statisticsSummary strong')[0].textContent==='7' && document.querySelector('[data-trend-total=income]').textContent==='1.120.000 aUEC'", 'seven-days-inclusive')
            expect("statisticsCustomers.textContent.includes('Current customer') && !statisticsCustomers.textContent.includes('Old customer')", 'customer-ranking-filtered')
            expect("stopHistoryList.textContent.includes('New stop') && !stopHistoryList.textContent.includes('Old stop')", 'stop-history-filtered')
            expect("statisticsFleetPerformanceSummary.textContent.includes('1.120.000')", 'ship-attribution-resolved')
            expect("document.querySelectorAll('[data-statistics-comparison]').length===4 && document.querySelector('[data-statistics-comparison=income]').textContent.includes('+880.000 aUEC') && document.querySelector('[data-statistics-comparison=income]').textContent.includes('+366,7 %')", 'week-financial-comparison')
            expect("document.querySelector('[data-statistics-comparison=completed]').textContent.includes('+6 Aufträge') && document.querySelector('[data-statistics-comparison=completed]').textContent.includes('Vorher: 1 Auftrag')", 'completed-contract-comparison')
            expect("!statisticsComparisonCaption.hidden && statisticsComparisonCaption.textContent.includes(new Date(StatisticsPeriod.shiftDay(statsToday,-13)+'T12:00:00').toLocaleDateString('de-DE'))", 'comparison-dates-visible')
            assert device.evaluate_js("statisticsPeriod.value==='all'")
            report['checks'].append('other-device-period-unchanged')
            screenshot('statistics-week-de')
            screenshot('statistics-chart-de', chart_only=True)
            preset('today')
            expect("document.querySelector('[data-trend-total=result]').textContent==='-25.000 aUEC' && statisticsTrendPosition.disabled", 'single-day-negative-result')
            expect("document.querySelector('[data-statistics-comparison=income]').textContent.includes('−20.000 aUEC') && document.querySelector('[data-statistics-comparison=completed]').textContent.includes('Unverändert')", 'today-compares-with-yesterday')
            preset('custom')
            pc.evaluate_js("statisticsStart.value=StatisticsPeriod.shiftDay(statsToday,-7);statisticsEnd.value=statsToday;statisticsPeriodForm.requestSubmit()")
            expect("statisticsTrendPosition.max==='7'", 'custom-inclusive-endpoints')
            expect("document.querySelector('[data-statistics-comparison=income]').textContent.includes('Vorher: 0 aUEC') && !document.querySelector('[data-statistics-comparison=income]').textContent.includes('%')", 'empty-baseline-without-percentage')
            pc.evaluate_js("statisticsTrendPosition.value=0;statisticsTrendPosition.dispatchEvent(new Event('input'))")
            expect("statisticsTrendReadout.textContent.includes('240.000 aUEC')", 'slider-selects-exact-values')
            pc.evaluate_js("const statsSvg=statisticsTrend.querySelector('svg');const statsBox=statsSvg.getBoundingClientRect();statsSvg.dispatchEvent(new PointerEvent('pointerdown',{clientX:statsBox.right-1,clientY:statsBox.top+40}));")
            expect("statisticsTrendPosition.value==='7' && statisticsTrendReadout.textContent.includes('-25.000 aUEC')", 'chart-tap-selects-point')
            pc.evaluate_js("statisticsTrend.querySelector('summary').click()")
            expect("statisticsTrend.querySelector('details').open && statisticsTrend.querySelectorAll('tbody tr').length===8", 'accessible-data-table')
            pc.evaluate_js("statisticsStart.value=StatisticsPeriod.shiftDay(statsToday,1);statisticsPeriodForm.requestSubmit()")
            expect("!statisticsPeriodError.hidden && document.querySelector('[data-trend-total=income]').textContent==='1.360.000 aUEC'", 'invalid-range-keeps-applied-results')
            preset('month')
            expect("statisticsPeriodError.hidden && statisticsCustomPeriod.hidden", 'preset-clears-validation')
            preset('week')
            pc.evaluate_js("state.uiLanguage='en';translateStaticText();statisticsController.render()")
            expect("statisticsTrendTitle.textContent==='Results over time' && statisticsPeriod.options[2].textContent==='Last 7 days' && statisticsTrend.textContent.includes('Operating result')", 'english-labels-and-currency')
            expect("statisticsComparisonCaption.textContent.startsWith('Compared with:') && document.querySelector('[data-statistics-comparison=income]').textContent.includes('+880,000 aUEC') && document.querySelector('[data-statistics-comparison=income]').textContent.includes('+366.7 %')", 'english-comparison-format')
            pc.resize(768, 1024)
            time.sleep(.4)
            expect("document.documentElement.scrollWidth<=innerWidth+1", 'portrait-no-horizontal-overflow')
            expect("document.querySelectorAll('[data-statistics-comparison]').length===4 && document.querySelector('[data-statistics-comparison=income]').textContent.includes('Previously:')", 'comparisons-survive-chart-resize')
            screenshot('statistics-portrait-en')
            pc.resize(390, 844)
            time.sleep(.4)
            expect("document.querySelector('.statistics-trend-panel').getBoundingClientRect().right<=innerWidth+1 && statisticsPeriod.getBoundingClientRect().right<=innerWidth+1", 'phone-chart-and-filter-fit')
            expect("document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('[data-statistics-comparison=income]').getBoundingClientRect().width>0", 'phone-comparisons-fit')
            screenshot('statistics-phone-en')
            screenshot('statistics-phone-chart-en', chart_only=True)
            preset('custom')
            expect("statisticsCustomPeriod.getBoundingClientRect().right<=innerWidth+1 && statisticsEnd.getBoundingClientRect().right<=innerWidth+1", 'phone-custom-filter-fits')
            preset('week')
            pc.resize(1280, 720)
            pc.evaluate_js("state.ledgerEntries.push({id:'late',bookedOn:statsToday,missionId:'test-mission-7',flow:'income',amountAuec:50});statisticsController.render()")
            expect("document.querySelectorAll('#statisticsSummary strong')[1].textContent==='7'", 'late-payment-does-not-recount-old-completion')
            pc.evaluate_js("state.ledgerEntries.push({id:'undated',amountAuec:10,flow:'income'});statisticsController.render()")
            expect("!statisticsPeriodUndated.hidden", 'undated-records-disclosed')
            preset('all')
            expect("statisticsTrend.textContent.includes('cannot be plotted')", 'undated-chart-gap-disclosed')
            preset('custom')
            pc.evaluate_js("statisticsStart.value='2099-01-01';statisticsEnd.value='2099-01-02';statisticsPeriodForm.requestSubmit()")
            expect("statisticsTrend.textContent.includes('No dated') && !statisticsTrend.querySelector('svg')", 'empty-custom-period')
            expect("[...document.querySelectorAll('[data-statistics-comparison]')].every(e=>e.textContent.includes('Unchanged')) && !statisticsTrend.textContent.includes('NaN') && !statisticsTrend.textContent.includes('Infinity')", 'empty-periods-remain-neutral')
            pc.evaluate_js("statisticsStart.value=StatisticsPeriod.shiftDay(statsToday,1);statisticsEnd.value=StatisticsPeriod.shiftDay(statsToday,2);statisticsPeriodForm.requestSubmit()")
            expect("document.querySelector('[data-statistics-comparison=income]').textContent.includes('−100 %') && document.querySelector('[data-statistics-comparison=expense]').classList.contains('is-better')", 'empty-current-period-compares-with-prior-bookings')
            pc.evaluate_js("""(() => {
              const yesterday=StatisticsPeriod.shiftDay(statsToday,-1);
              state.missions=[];state.stopHistory=[];
              state.ledgerEntries=[
                {id:'past1',bookedOn:yesterday,amountAuec:60,flow:'income',missionId:'deleted-contract',fleetEntryId:'test-ship'},
                {id:'past2',bookedOn:yesterday,amountAuec:40,flow:'income',missionId:'deleted-contract',fleetEntryId:'test-ship'},
                {id:'past-cost',bookedOn:yesterday,amountAuec:200,flow:'expense'},
                {id:'now-income',bookedOn:statsToday,amountAuec:80,flow:'income'},
                {id:'now-cost',bookedOn:statsToday,amountAuec:20,flow:'expense'}
              ];
            })()""")
            preset('today')
            expect("document.querySelector('[data-statistics-comparison=expense]').textContent.includes('−180 aUEC') && document.querySelector('[data-statistics-comparison=expense]').textContent.includes('−90 %') && document.querySelector('[data-statistics-comparison=expense]').classList.contains('is-better')", 'lower-expenses-marked-as-improvement')
            expect("document.querySelector('[data-statistics-comparison=result]').textContent.includes('+160 aUEC') && document.querySelector('[data-statistics-comparison=result]').textContent.includes('Previously: −100 aUEC') && !document.querySelector('[data-statistics-comparison=result]').textContent.includes('%')", 'negative-baseline-uses-absolute-difference')
            expect("document.querySelector('[data-statistics-comparison=completed]').textContent.includes('Previously: 1 contract')", 'legacy-contract-count-not-duplicated-by-payments')
            preset('all')
            expect("statisticsComparisonCaption.hidden && !document.querySelector('[data-statistics-comparison]')", 'all-time-removes-stale-comparisons')
            preset('week')
            pc.evaluate_js("window.oldStatsPage=true;setTimeout(()=>location.reload(),0)")
            until(pc, "!window.oldStatsPage && window.soloStartup?.phase==='ready'")
            expect("statisticsPeriod.value==='week'", 'filter-survives-reload')
            for window in [pc, device]:
                assert not window.evaluate_js('window.soloErrors'), window.evaluate_js('window.soloErrors')
            report['ok'] = True
        except Exception as error:
            report.update(error=str(error), traceback=traceback.format_exc(), errors=pc.evaluate_js('window.soloErrors'))
        finally:
            (args.data_dir / 'statistics-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            for window in [pc, device]: window.destroy()
    try:
        webview.start(check, gui='edgechromium', private_mode=False, storage_path=str(args.data_dir / 'WebView'))
    finally:
        faulthandler.cancel_dump_traceback_later()
        runtime.stop()
        trace_file.close()
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
