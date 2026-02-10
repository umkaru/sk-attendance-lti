// public/js/student.js
// Frontend für Studenten-Statistiken

class StudentStats {
  constructor(courseId, canvasSessionId) {
    this.courseId = courseId;
    this.canvasSessionId = canvasSessionId;
    this.stats = null;
    this.sessions = [];
  }

  async loadStats() {
    try {
      const response = await fetch(
        `/api/student/stats/${this.courseId}?sid=${this.canvasSessionId}`,
        { credentials: 'include' }
      );

      if (!response.ok) throw new Error('Fehler beim Laden');

      const data = await response.json();

      if (data.success) {
        this.stats = data.stats;
        this.sessions = data.sessions;
        this.renderDashboard();
      }

    } catch (error) {
      console.error('Error loading stats:', error);
      document.getElementById('stats-container').innerHTML = `
        <div style="padding: 40px; text-align: center; color: #ef4444;">
          <h2>Fehler beim Laden der Statistiken</h2>
          <p>${error.message}</p>
        </div>
      `;
    }
  }

  renderDashboard() {
    if (!this.stats) {
      document.getElementById('stats-container').innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <h2>Noch keine Daten vorhanden</h2>
          <p>Sobald Anwesenheitsdaten erfasst wurden, siehst du hier deine Statistiken.</p>
        </div>
      `;
      return;
    }

    const rateColor = this.stats.attendanceRate >= 80 ? '#10b981' : 
                      this.stats.attendanceRate >= 60 ? '#f59e0b' : '#ef4444';

    document.getElementById('stats-container').innerHTML = `
      <div class="stats-dashboard">
        <div class="stats-cards">
          <div class="stat-card">
            <div class="stat-icon">⏱️</div>
            <div class="stat-value">${this.stats.totalHours}h</div>
            <div class="stat-label">Gesamtstunden</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value" style="color: ${rateColor}">${this.stats.attendanceRate}%</div>
            <div class="stat-label">Anwesenheitsquote</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">📚</div>
            <div class="stat-value">${this.stats.attendedSessions}/${this.stats.totalSessions}</div>
            <div class="stat-label">Sessions besucht</div>
          </div>
        </div>

        <div class="progress-section">
          <h3>Anwesenheits-Fortschritt</h3>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${this.stats.attendanceRate}%; background: ${rateColor};">
              ${this.stats.attendanceRate}%
            </div>
          </div>
          <p class="progress-label">
            ${this.getProgressMessage(this.stats.attendanceRate)}
          </p>
        </div>

        <div class="sessions-section">
          <h3>Meine Sessions</h3>
          ${this.renderSessionsList()}
        </div>
      </div>
    `;
  }

  renderSessionsList() {
    if (this.sessions.length === 0) {
      return '<p>Noch keine Sessions vorhanden.</p>';
    }

    return `
      <table class="sessions-table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Session</th>
            <th>Zeit</th>
            <th>Status</th>
            <th>Stunden</th>
          </tr>
        </thead>
        <tbody>
          ${this.sessions.map(session => this.renderSessionRow(session)).join('')}
        </tbody>
      </table>
    `;
  }

  renderSessionRow(session) {
    const date = new Date(session.start_ts);
    const status = session.status || 'not_attended';
    const statusLabel = this.getStatusLabel(status);
    const statusClass = this.getStatusClass(status);
    
    const hours = session.net_minutes 
      ? (session.net_minutes / 60).toFixed(2) 
      : '-';

    const expectedHours = (session.expected_minutes / 60).toFixed(2);

    let timeDisplay = '';
    if (session.present_from && session.present_to) {
      const from = new Date(session.present_from);
      const to = new Date(session.present_to);
      timeDisplay = `${from.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - ${to.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}`;
    } else {
      const start = new Date(session.start_ts);
      const end = new Date(session.end_ts);
      timeDisplay = `${start.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - ${end.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}`;
    }

    return `
      <tr class="session-row ${statusClass}">
        <td>${date.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'})}</td>
        <td>
          <strong>${session.session_name}</strong>
          ${session.note ? `<br><small style="color: #64748b;">${session.note}</small>` : ''}
        </td>
        <td><small>${timeDisplay}</small></td>
        <td>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </td>
        <td>
          ${status !== 'absent' && status !== 'not_attended' 
            ? `<strong>${hours}h</strong> <small>/ ${expectedHours}h</small>` 
            : `<span style="color: #94a3b8;">-</span>`
          }
        </td>
      </tr>
    `;
  }

  getStatusLabel(status) {
    const labels = {
      present: 'Anwesend',
      late: 'Verspätet',
      partial: 'Teilweise',
      absent: 'Abwesend',
      excused: 'Entschuldigt',
      not_attended: 'Nicht erfasst'
    };
    return labels[status] || 'Unbekannt';
  }

  getStatusClass(status) {
    if (!status) return 'status-not-recorded';
    return 'status-' + status.replace('_', '-');
  }

  getProgressMessage(rate) {
    if (rate >= 90) return '🌟 Hervorragend! Weiter so!';
    if (rate >= 80) return '✅ Sehr gut!';
    if (rate >= 70) return '👍 Gut';
    if (rate >= 60) return '⚠️ Akzeptabel, aber ausbaufähig';
    return '❌ Achtung: Anwesenheit zu niedrig!';
  }
}

let studentStats;
