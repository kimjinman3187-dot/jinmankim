(function installScheduleAutoReflect(global) {
  'use strict';

  var API_URL = 'https://api.github.com/repos/kimjinman3187-dot/jinmankim/pulls?state=all&sort=updated&direction=desc&per_page=100';
  var WORK_ITEMS = Object.freeze([
    Object.freeze({ id: 'WORK31', prNumber: 167, label: '문서결재 대시보드' }),
    Object.freeze({ id: 'WORK32', prNumber: 168, label: 'LIVE 문서결재 요약' }),
    Object.freeze({ id: 'WORK33', prNumber: 169, label: 'LIVE 내부 상세 대시보드' }),
    Object.freeze({ id: 'WORK34', prNumber: null, label: 'Schedule 자동 반영' })
  ]);

  function text(value) {
    return String(value == null ? '' : value);
  }

  function pullMatchesWork(pull, work) {
    if (!pull || !work) return false;
    if (work.prNumber != null) return Number(pull.number) === work.prNumber;
    var haystack = [
      pull.title,
      pull.head && pull.head.ref,
      pull.body
    ].map(text).join(' ').toUpperCase();
    return haystack.indexOf(work.id) >= 0;
  }

  function latestMatchingPull(pulls, work) {
    var matches = pulls.filter(function (pull) { return pullMatchesWork(pull, work); });
    matches.sort(function (a, b) {
      if (Boolean(a.merged_at) !== Boolean(b.merged_at)) return a.merged_at ? -1 : 1;
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });
    return matches[0] || null;
  }

  function computeSchedule(pulls, workItems) {
    var source = Array.isArray(pulls) ? pulls : [];
    var items = (workItems || WORK_ITEMS).map(function (work) {
      var pull = latestMatchingPull(source, work);
      var merged = Boolean(pull && pull.merged_at);
      return {
        id: work.id,
        label: work.label,
        expectedPrNumber: work.prNumber,
        prNumber: pull ? Number(pull.number) : null,
        merged: merged,
        mergedAt: merged ? pull.merged_at : null,
        state: merged ? 'completed' : (pull ? 'in_progress' : 'planned')
      };
    });
    var completed = items.filter(function (item) { return item.merged; }).length;
    var total = items.length;
    var progress = total ? Math.round((completed / total) * 100) : 0;
    var next = items.find(function (item) { return !item.merged; }) || null;
    return {
      items: items,
      completed: completed,
      total: total,
      progress: progress,
      releaseReady: total > 0 && completed === total,
      nextWork: next ? next.id : '없음'
    };
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderRows(items) {
    var body = document.getElementById('scheduleWorkBody');
    if (!body) return;
    body.textContent = '';
    items.forEach(function (item) {
      var row = document.createElement('tr');
      var work = document.createElement('td');
      var pr = document.createElement('td');
      var status = document.createElement('td');
      var evidence = document.createElement('td');
      work.textContent = item.id;
      pr.textContent = item.prNumber ? ('#' + item.prNumber) : '-';
      status.textContent = item.merged ? '완료' : (item.state === 'in_progress' ? '진행 중' : '진행 예정');
      status.className = item.merged ? 'status-done' : 'status-check';
      evidence.textContent = item.merged
        ? ('병합 완료 · ' + new Date(item.mergedAt).toLocaleString('ko-KR'))
        : (item.prNumber ? 'Open/Draft PR은 완료에서 제외' : '병합 PR 자동 탐색');
      row.append(work, pr, status, evidence);
      body.appendChild(row);
    });
  }

  function renderSchedule(schedule) {
    setText('scheduleCompletedCount', schedule.completed + ' / ' + schedule.total);
    setText('scheduleProgressValue', schedule.progress + '%');
    setText('scheduleReleaseState', schedule.releaseReady ? '준비 완료' : '준비 중');
    setText('scheduleNextWork', schedule.nextWork);
    var release = document.getElementById('scheduleReleaseState');
    if (release) release.className = 'schedule-value ' + (schedule.releaseReady ? 'status-done' : 'status-check');
    var bar = document.getElementById('scheduleProgressBar');
    if (bar) bar.style.width = schedule.progress + '%';
    renderRows(schedule.items);
  }

  async function sync(options) {
    var opts = options || {};
    var fetchImpl = opts.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') return { ok: false, error: new Error('fetch unavailable') };
    try {
      var response = await fetchImpl(opts.apiUrl || API_URL, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response || !response.ok) throw new Error('GitHub sync failed: ' + (response && response.status));
      var pulls = await response.json();
      if (!Array.isArray(pulls)) throw new Error('GitHub response is not an array');
      var schedule = computeSchedule(pulls, opts.workItems || WORK_ITEMS);
      renderSchedule(schedule);
      setText('scheduleSyncState', 'GitHub 병합 상태 자동 반영 완료 · ' + new Date().toLocaleString('ko-KR'));
      var syncState = document.getElementById('scheduleSyncState');
      if (syncState) syncState.className = 'schedule-sync';
      return { ok: true, schedule: schedule };
    } catch (error) {
      var state = document.getElementById('scheduleSyncState');
      if (state) {
        state.textContent = '자동 동기화 실패 · 마지막 정상 Schedule을 유지합니다.';
        state.className = 'schedule-sync schedule-sync-error';
      }
      return { ok: false, error: error };
    }
  }

  var api = {
    API_URL: API_URL,
    WORK_ITEMS: WORK_ITEMS,
    pullMatchesWork: pullMatchesWork,
    computeSchedule: computeSchedule,
    renderSchedule: renderSchedule,
    sync: sync
  };

  global.YJScheduleAutoReflect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { sync(); }, { once: true });
    } else {
      sync();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
