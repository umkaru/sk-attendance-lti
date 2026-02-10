// public/js/attendance.js
// Frontend JavaScript für Anwesenheitserfassung

class AttendanceManager {
  constructor(sessionId, canvasSessionId) {
    this.sessionId = sessionId;
    this.canvasSessionId = canvasSessionId;
    this.students = [];
  }

  async loadStudents() {
    try {
      const response = await fetch(
        `/api/attendance/session/${this.sessionId}?sid=${this.canvasSessionId}`,
        { credentials: 'include' }
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Laden');
      }
      
      const data = await response.json();
      this.students = data.students;
      this.renderStudents();
      
    } catch (error) {
      console.error('Error loading students:', error);
      alert('Fehler beim Laden der Studenten: ' + error.message);
    }
  }

  async recordAttendance(userId, status, times = {}) {
    try {
      const response = await fetch(
        `/api/attendance?sid=${this.canvasSessionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sessionId: this.sessionId,
            userId,
            status,
            ...times
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Speichern');
      }
      
      await this.loadStudents();
      return true;
      
    } catch (error) {
      console.error('Error recording attendance:', error);
      alert('Fehler: ' + error.message);
      return false;
    }
  }

  async markAllPresent() {
    const sessionTimes = this.getSessionTimes();
    if (!sessionTimes) return;

    const studentIds = this.students.map(s => s.id);

    try {
      const response = await fetch(
        `/api/attendance/bulk?sid=${this.canvasSessionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sessionId: this.sessionId,
            studentIds,
            status: 'present',
            ...sessionTimes
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Speichern');
      }
      
      alert('Alle als anwesend markiert!');
      await this.loadStudents();
      
    } catch (error) {
      console.error('Error bulk marking:', error);
      alert('Fehler: ' + error.message);
    }
  }

  getSessionTimes() {
    const date = document.getElementById('attendanceDate')?.value;
    const startTime = document.getElementById('startTime')?.value;
    const endTime = document.getElementById('endTime')?.value;
    const breakMinutes = parseInt(document.getElementById('breakMinutes')?.value || 0);

    if (!date || !startTime || !endTime) {
      alert('Bitte Datum und Zeiten eingeben!');
      return null;
    }

    return {
      presentFrom: `${date}T${startTime}`,
      presentTo: `${date}T${endTime}`,
      breakMinutes
    };
  }

  renderStudents() {
    const container = document.getElementById('students-list');
    if (!container) return;

    if (this.students.length === 0) {
      container.innerHTML = '<p>Keine Studenten gefunden.</p>';
      return;
    }

    container.innerHTML = `
      <table class="attendance-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Stunden</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${this.students.map(student => this.renderStudentRow(student)).join('')}
        </tbody>
      </table>
    `;
    // ===== NEU: Event-Listener für alle Dropdowns =====
  container.querySelectorAll('select').forEach(select => {
    select.addEventListener('change', (e) => {
      const studentId = parseInt(e.target.getAttribute('data-student-id'));
      const status = e.target.value;
      if (status && studentId) {
        this.handleStatusChange(studentId, status);
      }
    });
  });
  // ===== ENDE NEU =====
  }

  renderStudentRow(student) {
    const statusClass = student.status || 'not-recorded';
    const statusLabel = this.getStatusLabel(student.status);
    const hours = student.net_minutes ? (student.net_minutes / 60).toFixed(2) : '-';
    
    let timeDetails = '';
    if (student.present_from && student.present_to) {
      const from = new Date(student.present_from);
      const to = new Date(student.present_to);
      timeDetails = `<br><small style="color: #64748b;">${from.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - ${to.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</small>`;
    }

    return `
      <tr class="student-row status-${statusClass}" id="student-${student.id}">
        <td>${student.name}${timeDetails}</td>
        <td>
          <span class="status-badge status-${statusClass}">${statusLabel}</span>
        </td>
        <td>${hours}h</td>
        <td>
          <select data-student-id="${student.id}">
  <option value="">Aktion wählen...</option>
  <option value="present" ${student.status === 'present' ? 'selected' : ''}>Anwesend (volle Zeit)</option>
  <option value="late" ${student.status === 'late' ? 'selected' : ''}>Verspätet angekommen</option>
  <option value="partial" ${student.status === 'partial' ? 'selected' : ''}>Früher gegangen</option>
  <option value="absent" ${student.status === 'absent' ? 'selected' : ''}>Abwesend</option>
  <option value="excused" ${student.status === 'excused' ? 'selected' : ''}>Entschuldigt</option>
</select>
          ${student.excuse_filename 
            ? `<br><small>📎 <a href="/api/excuses/${student.excuse_filename}?sid=${this.canvasSessionId}" target="_blank" style="color: #6366f1;">Entschuldigung</a></small>` 
            : ''
          }
        </td>
      </tr>
    `;
  }

  getStatusLabel(status) {
    const labels = {
      present: 'Anwesend',
      absent: 'Abwesend',
      late: 'Verspätet',
      excused: 'Entschuldigt',
      partial: 'Teilweise'
    };
    return labels[status] || 'Nicht erfasst';
  }

async handleStatusChange(studentId, status) {
  if (!status) return;

  // Konvertiere studentId zu String für Vergleich
  const studentIdStr = String(studentId);
  const student = this.students.find(s => s.id === studentIdStr);
  if (!student) return;

  console.log('Status change:', status, 'for student:', student.name);

  // Zeige Modal für 'late' und 'partial'
  if (status === 'late') {
    console.log('Showing late modal');
    this.showLateModal(student);
    return;
  }

  if (status === 'partial') {
    console.log('Showing partial modal');
    this.showPartialModal(student);
    return;
  }

  // Für andere Status direkt speichern
  console.log('Direct save for status:', status);
  await this.updateAttendance(student, status);
}

  showIndividualTimeModal(userId, status, student) {
    const date = document.getElementById('attendanceDate').value;
    const sessionStart = document.getElementById('startTime').value;
    const sessionEnd = document.getElementById('endTime').value;
    
    if (!date || !sessionStart || !sessionEnd) {
      alert('Bitte erst Session-Zeiten oben eingeben!');
      return;
    }

    const statusText = status === 'late' ? 'verspätet angekommen' : 'früher gegangen';
    const timeLabel = status === 'late' ? 'Tatsächliche Startzeit' : 'Tatsächliche Endzeit';
    const defaultTime = status === 'late' ? sessionStart : sessionEnd;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
        <h2>⏰ ${student.name} - ${statusText}</h2>
        
        <div class="time-modal-content">
          <p><strong>Session-Zeit:</strong> ${sessionStart} - ${sessionEnd}</p>
          
          <div class="form-group">
            <label>${timeLabel}:</label>
            <input type="time" id="individualTime" value="${defaultTime}" required>
          </div>

          ${status === 'late' ? `
            <div class="form-group">
              <label>Endzeit (optional, Standard: Session-Ende):</label>
              <input type="time" id="individualEndTime" value="${sessionEnd}">
            </div>
          ` : `
            <div class="form-group">
              <label>Startzeit (optional, Standard: Session-Start):</label>
              <input type="time" id="individualStartTime" value="${sessionStart}">
            </div>
          `}
          
          <div class="form-group">
            <label>Pause (Minuten):</label>
            <input type="number" id="individualBreak" value="0" min="0">
          </div>
          
          <div class="form-group">
            <label>Notiz (optional):</label>
            <textarea id="individualNotes" rows="2" placeholder="z.B. Arzttermin, Verspätung durch Bahn, etc."></textarea>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-danger" onclick="this.closest('.modal').remove()">Abbrechen</button>
          <button class="btn" onclick="attendanceManager.saveIndividualTime(${userId}, '${status}')">Speichern</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }

  async saveIndividualTime(userId, status) {
    const date = document.getElementById('attendanceDate').value;
    const sessionStart = document.getElementById('startTime').value;
    const sessionEnd = document.getElementById('endTime').value;
    
    let actualStart, actualEnd;
    
    if (status === 'late') {
      actualStart = document.getElementById('individualTime').value;
      actualEnd = document.getElementById('individualEndTime').value || sessionEnd;
    } else {
      actualStart = document.getElementById('individualStartTime').value || sessionStart;
      actualEnd = document.getElementById('individualTime').value;
    }
    
    const breakMinutes = parseInt(document.getElementById('individualBreak').value || 0);
    const notes = document.getElementById('individualNotes').value;

    const times = {
      presentFrom: `${date}T${actualStart}`,
      presentTo: `${date}T${actualEnd}`,
      breakMinutes,
      notes
    };

    await this.recordAttendance(userId, status, times);
    
    document.querySelector('.modal').remove();
  }
  
  // QR-Code Check-In Funktionen
  async generateQRCode() {
    try {
      const response = await fetch(
        `/api/checkin/generate/${this.sessionId}?sid=${this.canvasSessionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            validMinutes: 15
          })
        }
      );

      if (!response.ok) throw new Error('Fehler beim Generieren');

      const data = await response.json();
      this.showQRCodeModal(data);

    } catch (error) {
      console.error('Error generating QR code:', error);
      alert('Fehler beim Generieren des QR-Codes: ' + error.message);
    }
  }

  showQRCodeModal(data) {
    const expiresAt = new Date(data.expiresAt);
    const expiresTime = expiresAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'qr-modal';
    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <span class="close" onclick="attendanceManager.closeQRModal()">&times;</span>
        <h2>📱 Self-Check-In QR-Code</h2>
        
        <div style="text-align: center; padding: 20px;">
          <div style="background: white; padding: 20px; border-radius: 8px; display: inline-block;">
            <img src="${data.qrCodeDataUrl}" alt="QR Code" style="max-width: 100%; height: auto;">
          </div>
          
          <div style="margin-top: 20px; padding: 15px; background: #f1f5f9; border-radius: 6px;">
            <p style="margin: 5px 0;"><strong>⏰ Gültig bis:</strong> ${expiresTime} Uhr (${data.validMinutes} Minuten)</p>
            <p style="margin: 5px 0; font-size: 14px; color: #64748b;">
              Studenten scannen diesen Code mit ihrem Smartphone, um sich einzuchecken.
            </p>
          </div>

          <div style="margin-top: 15px;">
            <p style="font-size: 13px; color: #64748b;">Check-In URL:</p>
            <p style="font-size: 12px; word-break: break-all; color: #475569;">${data.checkinUrl}</p>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-danger" onclick="attendanceManager.deactivateQRCode()">🔒 Deaktivieren</button>
          <button class="btn" onclick="attendanceManager.closeQRModal()">Schließen</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Auto-refresh alle 30 Sekunden um Status zu prüfen
    this.qrRefreshInterval = setInterval(() => {
      this.checkQRStatus();
    }, 30000);
  }

  async checkQRStatus() {
    try {
      const response = await fetch(
        `/api/checkin/status/${this.sessionId}?sid=${this.canvasSessionId}`,
        { credentials: 'include' }
      );

      const data = await response.json();

      if (!data.active) {
        // QR-Code ist nicht mehr aktiv
        this.closeQRModal();
        if (data.expired) {
          alert('QR-Code ist abgelaufen. Bitte generiere einen neuen.');
        }
      }
    } catch (error) {
      console.error('Error checking QR status:', error);
    }
  }

  async deactivateQRCode() {
    if (!confirm('QR-Code wirklich deaktivieren? Studenten können sich dann nicht mehr einchecken.')) {
      return;
    }

    try {
      const response = await fetch(
        `/api/checkin/deactivate/${this.sessionId}?sid=${this.canvasSessionId}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (!response.ok) throw new Error('Fehler beim Deaktivieren');

      alert('QR-Code deaktiviert!');
      this.closeQRModal();

    } catch (error) {
      console.error('Error deactivating QR code:', error);
      alert('Fehler: ' + error.message);
    }
  }

  closeQRModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) {
      modal.remove();
    }
    if (this.qrRefreshInterval) {
      clearInterval(this.qrRefreshInterval);
    }
  }

  // ===== NEU: Modal-Methoden für Zeiterfassung =====
  showLateModal(student) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  
  const currentTime = new Date().toTimeString().substring(0, 5);
  
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
      <h2>⏰ Verspätet angekommen</h2>
      <p><strong>${student.name}</strong></p>
      
      <div class="form-group">
        <label>Ankunftszeit:</label>
        <input type="time" id="late-arrival-time" value="${currentTime}">
      </div>

      <div class="form-group">
        <label>Notiz (optional):</label>
        <input type="text" id="late-note" placeholder="z.B. Stau, Arzttermin">
      </div>

      <div class="form-actions">
        <button class="btn btn-danger" onclick="this.closest('.modal').remove()">Abbrechen</button>
        <button class="btn" onclick="attendanceManager.saveLateArrival('${student.id}')">Speichern</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

  showPartialModal(student) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  
  const currentTime = new Date().toTimeString().substring(0, 5);
  
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
      <h2>🚪 Früher gegangen</h2>
      <p><strong>${student.name}</strong></p>
      
      <div class="form-group">
        <label>Abgangszeit:</label>
        <input type="time" id="partial-departure-time" value="${currentTime}">
      </div>

      <div class="form-group">
        <label>Notiz (optional):</label>
        <input type="text" id="partial-note" placeholder="z.B. Arzttermin">
      </div>

      <div class="form-actions">
        <button class="btn btn-danger" onclick="this.closest('.modal').remove()">Abbrechen</button>
        <button class="btn" onclick="attendanceManager.savePartialAttendance('${student.id}')">Speichern</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

  async saveLateArrival(studentId) {
  const arrivalTime = document.getElementById('late-arrival-time').value;
  const note = document.getElementById('late-note').value;
  
  if (!arrivalTime) {
    alert('Bitte Ankunftszeit angeben');
    return;
  }

  const student = this.students.find(s => s.id === String(studentId)); // ← String() hinzugefügt
  
  if (!student) {
    console.error('Student nicht gefunden:', studentId);
    alert('Fehler: Student nicht gefunden');
    return;
  }
  
  // Hole Datum und Endzeit aus DOM
  const date = document.getElementById('attendanceDate')?.value;
  const endTime = document.getElementById('endTime')?.value;
  const breakMinutes = parseInt(document.getElementById('breakMinutes')?.value) || 0;

  if (!date || !endTime) {
    alert('Fehler: Session-Daten nicht gefunden');
    return;
  }

  const presentFrom = `${date}T${arrivalTime}:00`;
  const presentTo = `${date}T${endTime}:00`;

  // Berechne Minuten
  const from = new Date(presentFrom);
  const to = new Date(presentTo);
  const totalMinutes = Math.round((to - from) / 1000 / 60);
  const netMinutes = Math.max(0, totalMinutes - breakMinutes);

  const data = {
    studentId: student.id,
    status: 'late',
    presentFrom,
    presentTo,
    minutes: totalMinutes,
    breakMinutes,
    netMinutes,
    note: note || `Verspätet angekommen um ${arrivalTime}`
  };

  await this.saveAttendance(data);
  document.querySelector('.modal')?.remove();
}

  async savePartialAttendance(studentId) {
  const departureTime = document.getElementById('partial-departure-time').value;
  const note = document.getElementById('partial-note').value;
  
  if (!departureTime) {
    alert('Bitte Abgangszeit angeben');
    return;
  }

  const student = this.students.find(s => s.id === String(studentId)); // ← String() hinzugefügt
  
  if (!student) {
    console.error('Student nicht gefunden:', studentId);
    alert('Fehler: Student nicht gefunden');
    return;
  }
  
  // Hole Datum und Startzeit aus DOM
  const date = document.getElementById('attendanceDate')?.value;
  const startTime = document.getElementById('startTime')?.value;
  const breakMinutes = parseInt(document.getElementById('breakMinutes')?.value) || 0;

  if (!date || !startTime) {
    alert('Fehler: Session-Daten nicht gefunden');
    return;
  }

  const presentFrom = `${date}T${startTime}:00`;
  const presentTo = `${date}T${departureTime}:00`;

  // Berechne Minuten
  const from = new Date(presentFrom);
  const to = new Date(presentTo);
  const totalMinutes = Math.round((to - from) / 1000 / 60);
  const netMinutes = Math.max(0, totalMinutes - breakMinutes);

  const data = {
    studentId: student.id,
    status: 'partial',
    presentFrom,
    presentTo,
    minutes: totalMinutes,
    breakMinutes,
    netMinutes,
    note: note || `Früher gegangen um ${departureTime}`
  };

  await this.saveAttendance(data);
  document.querySelector('.modal')?.remove();
}


  async saveAttendance(data) {
  try {
    const response = await fetch(`/api/attendance/mark?sid=${this.canvasSessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: this.sessionId,
        ...data
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success) {
      // Reload students to show updated data
      await this.loadStudents();
    } else {
      alert('Fehler beim Speichern: ' + (result.error || 'Unbekannter Fehler'));
    }
  } catch (error) {
    console.error('Error saving attendance:', error);
    alert('Fehler beim Speichern der Anwesenheit');
  }
}
  // ===== ENDE NEU =====
}

let attendanceManager;
