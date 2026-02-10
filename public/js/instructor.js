// public/js/instructor.js
// Frontend JavaScript für Dozenten

class SessionManager {
  constructor(courseId, sessionId) {
    this.courseId = courseId;
    this.sessionId = sessionId;
    this.sessions = [];
  }

  async loadSessions() {
    try {
      const response = await fetch(`/api/sessions/${this.courseId}?sid=${this.sessionId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.sessions = data.sessions;
        this.renderSessions();
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
      alert('Fehler beim Laden: ' + error.message);
    }
  }

  async createSession(sessionData) {
    try {
      const response = await fetch(`/api/sessions?sid=${this.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          courseId: this.courseId,
          ...sessionData
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error);
      }

      const data = await response.json();

      if (data.success) {
        alert('Session erfolgreich erstellt!');
        await this.loadSessions();
        return true;
      }
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Fehler: ' + error.message);
      return false;
    }
  }

  async deleteSession(sessionId) {
    if (!confirm('Session wirklich löschen?')) return;

    try {
      const response = await fetch(`/api/sessions/${sessionId}?sid=${this.sessionId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error);
      }

      const data = await response.json();

      if (data.success) {
        alert('Session gelöscht');
        await this.loadSessions();
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Fehler: ' + error.message);
    }
  }

// Session bearbeiten
  showEditForm(session) {
    const modal = document.getElementById('create-session-modal');
    const modalTitle = modal.querySelector('h2');
    const form = modal.querySelector('form');

    // Ändere Modal-Titel
    modalTitle.textContent = 'Session bearbeiten';

    // Fülle Formular mit Daten
    document.getElementById('sessionName').value = session.session_name;
    document.getElementById('sessionType').value = session.session_type;
    
    const startDate = new Date(session.start_ts);
    const endDate = new Date(session.end_ts);
    
    document.getElementById('sessionDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('startTime').value = startDate.toTimeString().substring(0, 5);
    document.getElementById('endTime').value = endDate.toTimeString().substring(0, 5);
    
    document.getElementById('isOnline').checked = session.is_online;
    document.getElementById('meetingUrl').value = session.meeting_url || '';
    document.getElementById('meetingPlatform').value = session.meeting_platform || '';
    document.getElementById('location').value = session.location || '';
    document.getElementById('description').value = session.description || '';
    document.getElementById('isMandatory').checked = session.is_mandatory;

    // Ändere Submit-Handler
    form.onsubmit = (e) => this.handleEditSession(e, session.id);

    modal.style.display = 'block';
  }

  async handleEditSession(e, sessionId) {
    e.preventDefault();

    const sessionData = {
      session_name: document.getElementById('sessionName').value,
      session_type: document.getElementById('sessionType').value,
      start_ts: `${document.getElementById('sessionDate').value}T${document.getElementById('startTime').value}:00`,
      end_ts: `${document.getElementById('sessionDate').value}T${document.getElementById('endTime').value}:00`,
      is_online: document.getElementById('isOnline').checked,
      meeting_url: document.getElementById('meetingUrl').value,
      meeting_platform: document.getElementById('meetingPlatform').value,
      location: document.getElementById('location').value,
      description: document.getElementById('description').value,
      is_mandatory: document.getElementById('isMandatory').checked
    };

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}?sid=${this.sessionId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(sessionData)
        }
      );

      if (!response.ok) throw new Error('Fehler beim Aktualisieren');

      const data = await response.json();

      if (data.success) {
        alert('Session erfolgreich aktualisiert!');
        this.hideCreateForm();
        this.loadSessions();
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Fehler beim Aktualisieren der Session: ' + error.message);
    }
  }


renderSessions() {
  const container = document.getElementById('sessions-list');
  if (!container) return;

  if (this.sessions.length === 0) {
    container.innerHTML = '<p>Noch keine Sessions erstellt.</p>';
    return;
  }

  container.innerHTML = this.sessions.map(session => {
    const date = new Date(session.start_ts);
    const endDate = new Date(session.end_ts);
    
    return `
      <div class="session-card">
        <div class="session-header">
          <h3>${session.session_name}</h3>
          <span class="session-type">${this.getTypeLabel(session.session_type)}</span>
        </div>
        <div class="session-details">
          <p>📅 ${date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p>⏰ ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</p>
          <p>⏱️ ${session.expected_minutes} Minuten</p>
          ${session.is_online ? `<p>🌐 Online ${session.meeting_url ? `(<a href="${session.meeting_url}" target="_blank">Link</a>)` : ''}</p>` : ''}
          ${session.location ? `<p>📍 ${session.location}</p>` : ''}
        </div>
        <div class="session-actions">
          <a href="/attendance/${session.id}?sid=${this.sessionId}" class="btn" style="text-decoration: none; display: inline-block; margin-right: 10px;">📝 Anwesenheit</a>
          <button class="btn" onclick='sessionManager.showEditForm(${JSON.stringify(session).replace(/'/g, "&#39;")})' style="background: #f59e0b; margin-right: 10px;">✏️ Bearbeiten</button>
          <button onclick="sessionManager.deleteSession(${session.id})" class="btn-danger">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
}

  getTypeLabel(type) {
    const labels = {
      'weekend': 'Wochenendkurs',
      'evening': 'Abendkurs',
      'online': 'Online-Seminar',
      'regular': 'Regulär'
    };
    return labels[type] || type;
  }

  showCreateForm() {
    const modal = document.getElementById('create-session-modal');
    if (modal) {
      modal.style.display = 'block';
    }
  }

  hideCreateForm() {
    const modal = document.getElementById('create-session-modal');
    const form = modal.querySelector('form');
    const modalTitle = modal.querySelector('h2');
    
    modal.style.display = 'none';
    form.reset();
    
    // Reset auf "Erstellen" Modus
    modalTitle.textContent = 'Neue Session erstellen';
    form.onsubmit = handleCreateSession;
  }
}

// Global initialisieren
let sessionManager;

// Formular-Handler
function handleCreateSession(event) {
  event.preventDefault();
  
  const formData = {
    sessionName: document.getElementById('sessionName').value,
    sessionType: document.getElementById('sessionType').value,
    sessionDate: document.getElementById('sessionDate').value,
    startTime: document.getElementById('startTime').value,
    endTime: document.getElementById('endTime').value,
    isOnline: document.getElementById('isOnline').checked,
    meetingUrl: document.getElementById('meetingUrl').value,
    meetingPlatform: document.getElementById('meetingPlatform').value,
    location: document.getElementById('location').value,
    description: document.getElementById('description').value,
    isMandatory: document.getElementById('isMandatory').checked
  };

  sessionManager.createSession(formData).then(success => {
    if (success) {
      event.target.reset();
      sessionManager.hideCreateForm();
    }
  });
}