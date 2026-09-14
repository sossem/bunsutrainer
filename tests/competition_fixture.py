"""Shared browser-only weekly competition fixture and actual entry interactions."""
import json
from pathlib import Path


def install(browser):
    browser.command('Page.addScriptToEvaluateOnNewDocument', {
        'source': Path(__file__).with_suffix('.js').read_text(encoding='utf-8')})


def field(browser, selector, value, event='change'):
    browser.eval('(() => {const e=document.querySelector(' + json.dumps(selector) + ');e.value='
                 + json.dumps(str(value)) + ';e.dispatchEvent(new Event(' + json.dumps(event)
                 + ',{bubbles:true}));})()')


def enter(browser):
    """Called after opening the personal mode; reused nicknames still require login."""
    if not browser.eval('!!ClassRanking.getSelection()'):
        field(browser, '#competition-school-query', '서울', 'input')
        browser.click('[data-action="competition-search"]')
        browser.wait('[data-action="competition-school-pick"]')
        browser.click('[data-action="competition-school-pick"][data-value="0"]')
        browser.click('[data-action="competition-class-select"]')
    if not browser.eval('!!WeeklyCompetition.getDraft(ClassRanking.getSelection()).confirmed'):
        browser.click('[data-action="competition-roll"]')
        browser.click('[data-action="competition-confirm"]')
        browser.wait_for('!!WeeklyCompetition.getDraft(ClassRanking.getSelection()).confirmed')
    browser.click('[data-action="competition-enter"]')
    browser.wait('.competition-setup')
