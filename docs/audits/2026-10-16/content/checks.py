"""Offline calculations supporting the report-content review; no network or credentials."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import re
import statistics

BASE = Path(__file__).resolve().parent


def calculate():
    history = json.loads((BASE / 'yahoo-history.json').read_text())
    prices = {
        item['symbol']: {
            row['date'][:10]: row['close'] for row in item.get('quotes', [])
            if row.get('close') is not None and row['date'][:10] < '2026-10-16'
        } for item in history
    }

    def pct(symbol, start, end):
        return (prices[symbol][end] / prices[symbol][start] - 1) * 100

    comparisons = []
    for report_date, start, end, claimed in [
        ('2026-10-13', '2026-10-08', '2026-10-12', -3.81),
        ('2026-10-14', '2026-10-12', '2026-10-13', -6.21),
        ('2026-10-16', '2026-10-14', '2026-10-15', -8.0),
    ]:
        snapshot = json.loads((BASE / f'market-snapshot-{report_date}.json').read_text())
        kospi_snapshot = next(item for item in snapshot['items'] if item['name'] == '코스피')
        assert abs(pct('^KS11', start, end) - kospi_snapshot['changePercent']) < 0.001
        comparisons.append({
            'report_date': report_date, 'source_session': end,
            'etf_report_kospi_claim_pct': claimed,
            'kospi_return_pct': round(pct('^KS11', start, end), 4),
            'kodex_200_return_pct': round(pct('069500.KS', start, end), 4),
            'claim_note': '10/16 body says more than 8%, not only a rounded headline' if report_date.endswith('16') else '',
        })

    controls = []
    report_sessions = [
        ('2026-10-12', '2026-10-08', '2026-10-09'),
        ('2026-10-13', '2026-10-09', '2026-10-12'),
        ('2026-10-14', '2026-10-12', '2026-10-13'),
        ('2026-10-15', '2026-10-13', '2026-10-14'),
        ('2026-10-16', '2026-10-14', '2026-10-15'),
    ]
    for report_date, start, end in report_sessions:
        snapshot = json.loads((BASE / f'market-snapshot-{report_date}.json').read_text())
        nasdaq = next(item for item in snapshot['items'] if item['name'] == '나스닥')
        calculated = pct('^IXIC', start, end)
        assert abs(calculated - nasdaq['changePercent']) < 0.001
        controls.append({'report_date': report_date, 'nasdaq_pct': round(calculated, 4),
                         'soxx_pct': round(pct('SOXX', start, end), 4),
                         'qqq_pct': round(pct('QQQ', start, end), 4)})

    weekly = {
        'period': '2026-10-08 close to 2026-10-15 close; week-to-date at Friday preopen',
        'kospi_wtd_pct': round(pct('^KS11', '2026-10-08', '2026-10-15'), 4),
        'kospi_monday_close_to_thursday_pct': round(pct('^KS11', '2026-10-12', '2026-10-15'), 4),
        'kodex_semiconductor_wtd_pct': round(pct('091160.KS', '2026-10-08', '2026-10-15'), 4),
        'kodex_semiconductor_last_session_pct': round(pct('091160.KS', '2026-10-14', '2026-10-15'), 4),
    }
    assert round(weekly['kodex_semiconductor_last_session_pct'], 2) == -11.94

    # Illustrative price-translation arithmetic, not a measured fund return.
    fx = [
        {'usd_asset_return_pct': asset, 'usdkrw_return_pct': exchange,
         'translated_krw_return_pct': round(((1 + asset / 100) * (1 + exchange / 100) - 1) * 100, 4)}
        for asset, exchange in [(0, 1), (0, -1), (-2, 1)]
    ]
    assert fx[0]['translated_krw_return_pct'] == 1

    nav_checks = [
        {'ticker': '458250', 'price': 33040, 'nav': 32668.93, 'displayed_premium_pct': 1.14},
        {'ticker': '091160', 'price': 112300, 'nav': 111893.12, 'displayed_premium_pct': 0.36},
    ]
    for row in nav_checks:
        row['calculated_premium_pct'] = round((row['price'] / row['nav'] - 1) * 100, 4)
        assert round(row['calculated_premium_pct'], 2) == row['displayed_premium_pct']

    heatmap = {
        'published_tactical_moves_pct': [-16.42, 15.79],
        'signed_mean_pct': round(statistics.mean([-16.42, 15.79]), 2),
        'mean_absolute_move_pct': round(statistics.mean([16.42, 15.79]), 2),
        'note': 'Both arithmetic calculations are correct; signed mean cancels opposite exposures and is not a volatility measure.',
    }
    cpi_kst = datetime(2026, 10, 14, 8, 30, tzinfo=ZoneInfo('America/New_York')).astimezone(ZoneInfo('Asia/Seoul'))
    text_controls = {}
    for report in json.loads((BASE / 'manifest.json').read_text())['reports']:
        text = (BASE / report['textFile']).read_text()
        text_controls[report['textFile']] = {
            'non_finance_links': len(report['nonFinanceLinks']),
            'semiconductor_name_mentions': text.count('KODEX 반도체'),
            'soxx_minus_091_mentions': text.count('SOXX -0.91%'),
        }

    results = {
        'entity_comparisons': comparisons, 'market_snapshot_controls': controls,
        'semiconductor_internal_consistency': {
            'session': '2026-10-13', 'published_card_pct': -3.96,
            'published_prose_band': '-8%대',
            'independent_return_pct': round(pct('091160.KS', '2026-10-12', '2026-10-13'), 4),
        },
        'weekly_periods': weekly, 'illustrative_fx_arithmetic': fx,
        'published_nav_arithmetic_controls': nav_checks, 'tactical_heatmap': heatmap,
        'calendar_controls': {'cpi_release_kst': cpi_kst.isoformat(),
                              'bok_2026_10_22_weekday': datetime(2026, 10, 22).strftime('%A'),
                              'employment_official_release_kst': '2026-10-16T08:00:00+09:00'},
        'rate_change': {'us10y_oct14': prices['^TNX']['2026-10-14'],
                        'us10y_oct15': prices['^TNX']['2026-10-15'],
                        'change_percentage_points': round(prices['^TNX']['2026-10-15'] - prices['^TNX']['2026-10-14'], 4)},
        'text_controls': text_controls,
    }
    return results


if __name__ == '__main__':
    results = calculate()
    (BASE / 'calculations.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in results.items() if key != 'text_controls'}, ensure_ascii=False, indent=2))
