# ROOTS Whiteboard

Collaborative, infinite-canvas whiteboard platform für ROOTS Consulting — Miro-Style, hosted auf GitHub Pages, mit Supabase Backend.

**Live:** https://pgoutzeris-stack.github.io/whiteboard/

## Stack

- **Frontend:** Vanilla HTML/CSS/JS (Single-Page-App) im ROOTS Design System
- **Backend:** Supabase (Auth · Postgres · Realtime)
- **Hosting:** GitHub Pages
- **Schema:** `whiteboard.*` in der gemeinsamen ROOTS Supabase-Instanz

## Features

### Canvas-Engine
- Unendlicher Koordinatenraum, Viewport-Culling-Rendering
- Zoom **10 % – 800 %** via Slider, Mausrad, Pinch, `⌘+/-`
- Pan via Hand-Tool, Mittelklick, Alt+Drag, Leertaste-Modus, Trackpad
- Drei Layer (Background · Objekte · UI) für Performance
- HiDPI / Retina ready

### Objekte & Tools
- Sticky Notes (8 Farben)
- Text mit Inline-Editor (Größe, Bold, Italic, Underline, Ausrichtung)
- Formen: Rechteck, Kreis, Dreieck, Raute
- Linien & Pfeile
- Freihand-Pen
- Frames (gruppieren Inhalte, dienen als Slides im Workshop-Modus)
- Bilder (Drag & Drop oder File-Picker)
- Kommentare (Pins auf Canvas)

### Bearbeiten
- Auswahl + Multi-Auswahl per Klick / Marquee / `⌘A`
- Move, Resize, Rotate (Shift = 15°-Snap)
- Z-Order: Forward · Backward · Lock
- Stil-Editor (Füllung · Rahmen · Linienstärke · Text-Optionen)
- Vollständiges Undo/Redo (100 Schritte)
- Copy · Paste · Duplicate

### Echtzeit-Kollaboration
- Supabase Postgres Changes → Sofortige Sync aller Objekte
- Live-Cursor mit Name + Farbe pro Teilnehmer
- Presence-Bar oben rechts mit Click-to-Follow
- Optimistic UI (lokale Aktion sofort, Sync im Hintergrund)

### Board-Management (Dashboard)
- Boards-Grid mit Thumbnails (auto-generiert)
- Filter: Meine · Geteilt · Favoriten · Zuletzt · Templates · Papierkorb
- Suche im Titel + Beschreibung
- Aktionen: Umbenennen · Duplizieren · Löschen
- 8 Templates: Brainstorm · Kanban · Retro · Mindmap · Customer Journey · SWOT · Flowchart · Leer

### Sharing & Permissions
- Teilen-Dialog mit Link kopieren
- E-Mail-Einladung mit Rollen: Editor · Kommentator · Betrachter
- Public-Mode (jeder mit Link)
- Per-Board RLS-Policies via SECURITY-DEFINER Helper-Funktion

### Versionshistorie
- Manuelle Snapshots mit optionalem Label
- Wiederherstellen ältere Versionen
- Vollständige Daten in `whiteboard.snapshots`

### Export
- PNG / JPEG (1× · 2× · 3× Skalierung)
- SVG (Vektor)
- JSON (Backup mit allen Objekten)
- Bereich: ganzes Board · Auswahl · Sichtbarer Viewport

### Workshop-Modus
- Frames werden zu Slides
- Vollbild-Fokus mit abgedimmter Umgebung
- ← → für Navigation
- Live-Sync auch im Workshop

### Mini-Map
- 200×140 px Übersicht unten links
- Sichtbarer Viewport als Brand-Rechteck
- Klick → Sprung dorthin

### Tastatur-Shortcuts
| Aktion | Shortcut |
|---|---|
| Tools | `V H N T R O A L P F` |
| Undo / Redo | `⌘Z` / `⌘⇧Z` |
| Copy / Paste / Dup | `⌘C` / `⌘V` / `⌘D` |
| Alles auswählen | `⌘A` |
| Löschen | `⌫` `Del` |
| Zoom 100% / fit | `⌘0` / `⌘1` |
| Workshop | `⌘.` |
| Hilfe | `?` |

## Setup

### 1. Supabase Schema

In der Supabase SQL-Konsole ausführen:

```bash
psql -h <host> -U postgres -d postgres -f schema.sql
```

Oder die `schema.sql` Datei direkt im SQL-Editor von Supabase ausführen.

Das Schema enthält:
- `whiteboard.boards` – Boards mit Metadaten + Thumbnail
- `whiteboard.board_members` – Sharing-Tabelle
- `whiteboard.objects` – Alle Canvas-Objekte (sticky, shape, text, line, path, ...)
- `whiteboard.comments` – Kommentare mit Threading
- `whiteboard.snapshots` – Versions-Snapshots
- `whiteboard.activity` – Audit-Log
- Helper `whiteboard.has_board_access(board_id, min_role)` für RLS
- RLS-Policies + Realtime-Publication aktiviert

### 2. GitHub Pages

- Push zu `main`
- In Repo-Settings → Pages → Source: `Deploy from a branch` · `main` · `/`
- Pages-URL: `https://pgoutzeris-stack.github.io/whiteboard/`

### 3. Auth

Die App nutzt den shared Supabase Auth Token (gleiche `users.profiles` Tabelle wie die anderen ROOTS Tools). Wer in Intranet / Onboarding etc. eingeloggt ist, wird hier automatisch erkannt.

## Architektur

### Schema-Design

```
whiteboard.boards
  └── whiteboard.board_members
  └── whiteboard.objects (deren z_index bestimmt Reihenfolge)
  └── whiteboard.comments (parent_id für Threads)
  └── whiteboard.snapshots (vollständige Backups)
  └── whiteboard.activity
```

### Realtime-Flow

```
User A erstellt Objekt
  → INSERT in whiteboard.objects
  → Postgres Notification
  → Supabase Realtime broadcastet
  → User B's Channel empfängt postgres_changes Event
  → handleObjectChange() aktualisiert lokale State.objects Map
  → scheduleRender() zeichnet neu
```

Eigene Updates werden über `updated_by = auth.uid()` gefiltert (keine Echo-Loops).

### Konfliktbehandlung

- Optimistic UI: lokale Änderung wird sofort gezeigt
- Last-Write-Wins über `updated_at` Trigger
- Bei gleichzeitiger Bearbeitung gewinnt das spätere Update — bewusst gewählt, da OT/CRDT für diese Skalierung Overkill ist

### Rendering-Pipeline

```
scheduleRender() (RAF-throttled)
  → render()
    → drawBackground (BG canvas)
    → drawObject(...) für jedes sichtbare Objekt (Main canvas)
    → drawUI (Selection, Marquee, Hover, Cursors) (UI canvas)
    → drawMinimap
```

Drei separate Canvases minimieren Redraws (BG bleibt unverändert bei reinem Selection-Change).

## Nicht implementiert

Bewusst weggelassen (laut Briefing):

- ❌ KI-Features (Clustering, Zusammenfassungen, ...)
- ❌ App-Integrationen (Slack, Jira, ...)
- ❌ Mobile / Pencil-Spezialbehandlung (Desktop läuft mit Maus & Trackpad)

## Datei-Struktur

```
whiteboard/
├── index.html      # UI (Login, Dashboard, Board, Modals)
├── app.js          # Komplette App-Logik
├── schema.sql      # Supabase-Schema + RLS
└── README.md       # Dieses Dokument
```

Co-Authored-By: Claude Sonnet 4.6
