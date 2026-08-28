(() => {
  const { createApp } = Vue;
  const DEFAULT_PARTS = ["검침", "WEB", "NMS", "연구과제"];
  const PART_PRESET_COLORS = {
    검침: "#1d4e89",
    WEB: "#6c3483",
    NMS: "#0e6655",
    연구과제: "#9a3412",
    자재관리: "#0891b2",
    SG: "#2563eb",
    고압: "#be185d",
    기타: "#6b7280"
  };
  const TASK_COLOR_PRESETS = ["#1f4e79", "#1a7a6d", "#6c3483", "#b03a2e", "#b9770e", "#1e8449", "#5d6d7e"];
  const IMPORTANT_TASK_COLOR = "#b03a2e";
  const LOCAL_TASKS_KEY = "systempart.tasks";
  const LOCAL_PARTS_KEY = "systempart.parts";
  const fb = window.AppFirebase;
  const PAGE_SIZE_OPTIONS = [10, 30, 50];
  const MAX_PART_NAME_LENGTH = 5;

  function partNameError(name) {
    const text = String(name || "").trim();
    if (!text) return "파트 이름을 입력하세요.";
    if (text.length > MAX_PART_NAME_LENGTH) return `파트 이름은 최대 ${MAX_PART_NAME_LENGTH}글자까지 가능합니다.`;
    return "";
  }

  function todayStamp() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function instructKey(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
    return "";
  }

  function parseInstructedDate(value) {
    const key = instructKey(value);
    if (!key) return null;
    const date = new Date(key + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function defaultDueDate(instructedAt, dueDate) {
    if (String(dueDate || "").trim()) return String(dueDate).trim();
    const base = parseInstructedDate(instructedAt) || new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + 30);
    const m = String(next.getMonth() + 1).padStart(2, "0");
    const d = String(next.getDate()).padStart(2, "0");
    return `${next.getFullYear()}-${m}-${d}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function clipToMonth(start, end, monthStart, monthEnd, days) {
    if (!start || !end || end < monthStart || start > monthEnd) return null;
    const barStart = start < monthStart ? monthStart : start;
    const barEnd = end > monthEnd ? monthEnd : end;
    if (barEnd < barStart) return null;
    const startDay = barStart.getDate();
    const endDay = barEnd.getDate();
    return {
      left: ((startDay - 1) / days) * 100 + "%",
      width: ((endDay - startDay + 1) / days) * 100 + "%"
    };
  }

  function taskSpan(task) {
    let start = parseInstructedDate(task.instructedAt);
    let end = parseInstructedDate(task.dueDate);
    if (!start && !end) return null;
    if (!start) {
      start = new Date(end);
      start.setDate(start.getDate() - 30);
    }
    if (!end) {
      end = new Date(start);
      end.setDate(end.getDate() + 30);
    }
    start = startOfDay(start);
    end = startOfDay(end);
    if (end < start) end = new Date(start);
    return { start, end };
  }

  function sortTasks(list) {
    return [...list].sort((a, b) => {
      if (Boolean(a.important) !== Boolean(b.important)) return a.important ? -1 : 1;
      const ka = instructKey(a.instructedAt);
      const kb = instructKey(b.instructedAt);
      if (ka !== kb) return kb.localeCompare(ka);
      return (b.seq || 0) - (a.seq || 0);
    });
  }

  function sortTasksBy(list, key, dir) {
    const factor = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (key === "seq") {
        cmp = (Number(a.seq) || 0) - (Number(b.seq) || 0);
      } else if (key === "instructedAt") {
        cmp = instructKey(a.instructedAt).localeCompare(instructKey(b.instructedAt));
        if (!instructKey(a.instructedAt) && instructKey(b.instructedAt)) cmp = 1;
        if (instructKey(a.instructedAt) && !instructKey(b.instructedAt)) cmp = -1;
        if (!instructKey(a.instructedAt) && !instructKey(b.instructedAt)) {
          cmp = String(a.instructedAt || "").localeCompare(String(b.instructedAt || ""), "ko");
        }
      } else if (key === "requester") {
        cmp = String(a.requester || "").localeCompare(String(b.requester || ""), "ko");
      } else if (key === "parts") {
        cmp = (a.parts || []).join(",").localeCompare((b.parts || []).join(","), "ko");
      } else if (key === "important") {
        cmp = Number(Boolean(a.important)) - Number(Boolean(b.important));
      } else if (key === "dueDate") {
        cmp = String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
      } else if (key === "progress") {
        cmp = (Number(a.progress) || 0) - (Number(b.progress) || 0);
      } else {
        return 0;
      }
      if (cmp !== 0) return cmp * factor;
      if (Boolean(a.important) !== Boolean(b.important)) return a.important ? -1 : 1;
      return (Number(b.seq) || 0) - (Number(a.seq) || 0);
    });
  }

  function defaultSort(partFilter) {
    if (partFilter === "전체") {
      return { sortKey: "seq", sortDir: "desc" };
    }
    return { sortKey: "important", sortDir: "desc" };
  }

  function clampProgress(value) {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function normalizeTitle(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function newSubtask(text) {
    return {
      id: "sub-" + Date.now() + "-" + Math.random().toString(16).slice(2),
      text: text || "",
      status: "진행"
    };
  }

  function normalizeSubtasks(list) {
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({
      id: item.id || newSubtask().id,
      text: item.text || "",
      status: item.status === "완료" || item.done === true ? "완료" : "진행"
    }));
  }

  function normalizeTask(raw, fallbackId) {
    const parts = Array.isArray(raw.parts) ? raw.parts.filter(Boolean) : [];
    return {
      id: raw.id || fallbackId,
      seq: Number(raw.seq) || 0,
      instructedAt: raw.instructedAt || "",
      requester: raw.requester || "",
      dueDate: defaultDueDate(raw.instructedAt, raw.dueDate),
      progress: clampProgress(raw.progress),
      parts,
      title: raw.title || "",
      detail: raw.detail || "",
      color: raw.color || "",
      important: Boolean(raw.important),
      subtasks: normalizeSubtasks(raw.subtasks),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  function isMarked(value) {
    const v = String(value || "").trim().toUpperCase();
    return ["O", "○", "ㅇ", "Y", "YES", "TRUE", "1", "중요"].includes(v);
  }

  function normalizeHeader(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/).find((line) => line.trim()) || "";
    const commas = (first.match(/,/g) || []).length;
    const tabs = (first.match(/\t/g) || []).length;
    const semis = (first.match(/;/g) || []).length;
    if (tabs > commas && tabs >= semis) return "\t";
    if (semis > commas) return ";";
    return ",";
  }

  function parseCsv(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const delim = detectDelimiter(source);
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((item) => item.some((value) => String(value).trim()));
  }

  function decodeFileText(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    if (!utf8.includes("\uFFFD")) return utf8;
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch {
      return utf8;
    }
  }

  function parseSubtasksColumn(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\[(진행|완료)\]\s*(.*)$/);
        if (match) return { text: match[2], status: match[1] };
        return { text: line.replace(/^-\s*/, ""), status: "진행" };
      });
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function buildCsvTemplate(parts) {
    const partHeaders = (parts || []).map((part) => `작업파트 ${part}`);
    const headers = [
      "순번",
      "작업지시일",
      "작업 요청자",
      "완료예정일",
      "진행률",
      "중요",
      ...partHeaders,
      "작업명",
      "세부내용",
      "세부작업"
    ];
    const exampleParts = (parts || []).map((_, idx) => (idx === 0 ? "O" : ""));
    const example = [
      "1",
      "2026-08",
      "홍길동",
      "2026-09-30",
      "0",
      "",
      ...exampleParts,
      "예시 작업명",
      "세부 내용을 입력합니다.",
      "[진행] 첫 번째 세부작업\n[완료] 두 번째 세부작업"
    ];
    const lines = [headers, example].map((row) => row.map(csvEscape).join(","));
    return "\uFEFF" + lines.join("\r\n");
  }

  function downloadTextFile(filename, content, mime = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvRowsToTasks(rows, knownParts) {
    if (!rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    const tasks = [];
    for (let r = 1; r < rows.length; r += 1) {
      const rec = {};
      headers.forEach((header, idx) => {
        rec[header] = rows[r][idx] == null ? "" : String(rows[r][idx]).trim();
      });
      const title = rec["작업명"] || rec["작업 명"] || rec["작업내용"] || rec["작업 내용"] || rec["title"] || "";
      if (!title) continue;
      const parts = [];
      const partSet = new Set(knownParts || []);
      headers.forEach((header) => {
        const value = rec[header];
        if (!isMarked(value)) return;
        if (header.startsWith("작업파트")) {
          const name = header.replace(/^작업파트\s*/, "").trim();
          if (name && !parts.includes(name)) parts.push(name);
          return;
        }
        if (partSet.has(header) && !parts.includes(header)) parts.push(header);
      });
      const subRaw = rec["세부작업"] || rec["세부 작업"] || "";
      tasks.push({
        seq: rec["순번"] || "",
        instructedAt: rec["작업지시일"] || rec["지시일"] || "",
        requester: rec["작업 요청자"] || rec["요청자"] || "",
        dueDate: defaultDueDate(rec["작업지시일"] || rec["지시일"] || "", rec["완료예정일"] || rec["예정일"] || ""),
        progress: rec["진행률"] || 0,
        parts,
        title,
        detail: rec["세부내용"] || rec["세부 내용"] || "",
        color: rec["색상"] || rec["color"] || "",
        important: isMarked(rec["중요"]),
        subtasks: parseSubtasksColumn(subRaw)
      });
    }
    return tasks;
  }

  function readLocalTasks() {
    try {
      const raw = localStorage.getItem(LOCAL_TASKS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return parsed.map((item) => normalizeTask(item, item.id));
    } catch {
      return [];
    }
  }

  function writeLocalTasks(tasks) {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  }

  function readLocalParts() {
    try {
      const raw = localStorage.getItem(LOCAL_PARTS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* ignore */
    }
    return [...DEFAULT_PARTS];
  }

  function partColor(name) {
    if (PART_PRESET_COLORS[name]) return PART_PRESET_COLORS[name];
    let hash = 0;
    for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 42% 38%)`;
  }

  function blankForm() {
    const today = todayStamp();
    return {
      open: false,
      id: "",
      seq: 0,
      instructedAt: today,
      requester: "",
      dueDate: defaultDueDate(today, ""),
      progress: 0,
      parts: [],
      title: "",
      detail: "",
      color: "",
      important: false,
      subtasks: []
    };
  }

  function blankExportForm() {
    return {
      open: false,
      periodMode: "all",
      dateFrom: "",
      dateTo: "",
      statusMode: "active",
      partMode: "all",
      selectedParts: []
    };
  }

  function tasksForExport(tasks, options) {
    let list = [...tasks];
    if (options.statusMode === "active") {
      list = list.filter((task) => task.progress < 100);
    } else if (options.statusMode === "done") {
      list = list.filter((task) => task.progress >= 100);
    }
    if (options.partMode === "part" && options.selectedParts?.length) {
      const picked = new Set(options.selectedParts);
      list = list.filter((task) => (task.parts || []).some((part) => picked.has(part)));
    }
    if (options.periodMode === "range") {
      const from = options.dateFrom;
      const to = options.dateTo;
      list = list.filter((task) => {
        const key = instructKey(task.instructedAt);
        if (!key) return false;
        return key >= from && key <= to;
      });
    }
    return sortTasks(list);
  }

  createApp({
    data() {
      return {
        TASK_COLOR_PRESETS,
        MAX_PART_NAME_LENGTH,
        view: "active",
        partFilter: "전체",
        keyword: "",
        tasks: [],
        parts: readLocalParts(),
        loading: true,
        expandedId: null,
        status: { type: "warn", message: "" },
        statusTimer: null,
        storageMode: "local",
        db: null,
        unsubscribe: null,
        unsubscribeSettings: null,
        form: blankForm(),
        newPartName: "",
        editingPart: null,
        editingPartName: "",
        requesterOpen: false,
        requesterIndex: 0,
        calendarYear: new Date().getFullYear(),
        calendarMonth: new Date().getMonth() + 1,
        currentUser: null,
        loginForm: { id: "" },
        loginError: "",
        loginBusy: false,
        sortKey: "seq",
        sortDir: "desc",
        pageSize: 10,
        page: 1,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        exportModal: blankExportForm()
      };
    },
    computed: {
      activeTasks() {
        return sortTasks(this.tasks.filter((t) => t.progress < 100));
      },
      doneTasks() {
        return sortTasks(this.tasks.filter((t) => t.progress >= 100));
      },
      activeCount() {
        return this.activeTasks.length;
      },
      doneCount() {
        return this.doneTasks.length;
      },
      activePartCounts() {
        const counts = {};
        this.parts.forEach((part) => {
          counts[part] = 0;
        });
        this.activeTasks.forEach((task) => {
          (task.parts || []).forEach((part) => {
            counts[part] = (counts[part] || 0) + 1;
          });
        });
        return counts;
      },
      filteredBase() {
        const source = this.view === "done" ? this.doneTasks : this.activeTasks;
        return source.filter((task) => {
          if (this.partFilter !== "전체" && !task.parts.includes(this.partFilter)) return false;
          if (!this.keyword) return true;
          const sub = (task.subtasks || []).map((s) => s.text).join(" ");
          const blob = `${task.title} ${task.detail} ${task.requester} ${sub}`.toLowerCase();
          return blob.includes(this.keyword.toLowerCase());
        });
      },
      sortedTasks() {
        if (!this.sortKey) return this.filteredBase;
        return sortTasksBy(this.filteredBase, this.sortKey, this.sortDir);
      },
      pageCount() {
        return Math.max(1, Math.ceil(this.sortedTasks.length / this.pageSize));
      },
      visibleTasks() {
        const start = (this.page - 1) * this.pageSize;
        return this.sortedTasks.slice(start, start + this.pageSize);
      },
      pageNumbers() {
        const total = this.pageCount;
        const current = this.page;
        const nums = [];
        let from = Math.max(1, current - 2);
        let to = Math.min(total, from + 4);
        from = Math.max(1, to - 4);
        for (let i = from; i <= to; i += 1) nums.push(i);
        return nums;
      },
      requesterOptions() {
        return [...new Set(this.tasks.map((t) => t.requester).filter(Boolean))].sort((a, b) =>
          a.localeCompare(b, "ko")
        );
      },
      filteredRequesters() {
        const q = (this.form.requester || "").trim().toLowerCase();
        const list = this.requesterOptions.filter((name) => name.toLowerCase().includes(q));
        return q ? list : this.requesterOptions;
      },
      excelParts() {
        const used = [...this.parts];
        this.tasks.forEach((task) => {
          (task.parts || []).forEach((part) => {
            if (!used.includes(part)) used.push(part);
          });
        });
        return used;
      },
      storageLabel() {
        return this.storageMode === "firebase" ? "Firebase" : "로컬";
      },
      needLogin() {
        return this.storageMode === "firebase" && !this.currentUser;
      },
      calendarLabel() {
        return `${this.calendarYear}년 ${this.calendarMonth}월`;
      },
      calendarDays() {
        const last = new Date(this.calendarYear, this.calendarMonth, 0).getDate();
        const today = new Date();
        const days = [];
        for (let n = 1; n <= last; n += 1) {
          const date = new Date(this.calendarYear, this.calendarMonth - 1, n);
          days.push({
            n,
            weekend: date.getDay() === 0 || date.getDay() === 6,
            today:
              today.getFullYear() === this.calendarYear &&
              today.getMonth() + 1 === this.calendarMonth &&
              today.getDate() === n
          });
        }
        return days;
      },
      calendarGridStyle() {
        return { gridTemplateColumns: `repeat(${this.calendarDays.length}, minmax(18px, 1fr))` };
      },
      calendarRows() {
        const monthStart = new Date(this.calendarYear, this.calendarMonth - 1, 1);
        const monthEnd = new Date(this.calendarYear, this.calendarMonth, 0);
        const days = this.calendarDays.length;
        return this.tasks
          .filter((task) => {
            if (this.partFilter !== "전체" && !(task.parts || []).includes(this.partFilter)) return false;
            const span = taskSpan(task);
            if (!span) return false;
            return span.end >= monthStart && span.start <= monthEnd;
          })
          .sort((a, b) => {
            const aDone = clampProgress(a.progress) >= 100;
            const bDone = clampProgress(b.progress) >= 100;
            if (aDone !== bDone) return aDone ? 1 : -1;
            if (!aDone) {
              const ai = Boolean(a.important);
              const bi = Boolean(b.important);
              if (ai !== bi) return ai ? -1 : 1;
            }
            return (Number(b.seq) || 0) - (Number(a.seq) || 0);
          })
          .map((task) => {
            const span = taskSpan(task);
            const planned = clipToMonth(span.start, span.end, monthStart, monthEnd, days);
            if (!planned) return null;
            const progress = clampProgress(task.progress) / 100;
            const dayMs = 24 * 60 * 60 * 1000;
            const totalMs = span.end.getTime() - span.start.getTime() + dayMs;
            const fillEnd = new Date(span.start.getTime() + totalMs * progress - 1);
            const fill = progress > 0 ? clipToMonth(span.start, fillEnd, monthStart, monthEnd, days) : null;
            return {
              id: task.id,
              task,
              title: task.title,
              important: Boolean(task.important),
              done: task.progress >= 100,
              color: task.color || this.partColor((task.parts || [])[0] || "") || "#1f4e79",
              left: planned.left,
              width: planned.width,
              fillLeft: fill ? fill.left : "0%",
              fillWidth: fill ? fill.width : "0%",
              hasFill: Boolean(fill),
              continuesLeft: span.start < monthStart,
              continuesRight: span.end > monthEnd
            };
          })
          .filter(Boolean);
      }
    },
    async mounted() {
      await this.connect();
      this.syncViewFromHash();
      window.addEventListener("hashchange", this.syncViewFromHash);
    },
    watch: {
      view(value) {
        const next =
          value === "done"
            ? "#/done"
            : value === "settings"
              ? "#/settings"
              : value === "calendar"
                ? "#/calendar"
                : "#/";
        if (location.hash !== next) location.hash = next;
        this.page = 1;
      },
      partFilter() {
        this.applyDefaultSort();
        this.page = 1;
      },
      keyword() {
        this.page = 1;
      },
      pageSize() {
        this.page = 1;
      },
      sortedTasks() {
        if (this.page > this.pageCount) this.page = this.pageCount;
      },
      "form.instructedAt"(value, previous) {
        if (!this.form.open) return;
        const prevAuto = defaultDueDate(previous, "");
        if (!this.form.dueDate || this.form.dueDate === prevAuto) {
          this.form.dueDate = defaultDueDate(value, "");
        }
      }
    },
    unmounted() {
      if (this.statusTimer) clearTimeout(this.statusTimer);
      if (this.unsubscribe) this.unsubscribe();
      if (this.unsubscribeSettings) this.unsubscribeSettings();
      window.removeEventListener("hashchange", this.syncViewFromHash);
    },
    methods: {
      partColor,
      partChipStyle(part) {
        return { "--chip-color": partColor(part) };
      },
      emptyForm(task) {
        if (!task) {
          const form = blankForm();
          form.open = true;
          return form;
        }
        return {
          open: true,
          id: task.id,
          seq: task.seq,
          instructedAt: task.instructedAt,
          requester: task.requester,
          dueDate: defaultDueDate(task.instructedAt, task.dueDate),
          progress: task.progress,
          parts: [...task.parts],
          title: task.title,
          detail: task.detail,
          color: task.color || "",
          important: Boolean(task.important),
          subtasks: normalizeSubtasks(task.subtasks).map((item) => ({ ...item }))
        };
      },
      setStatus(type, message) {
        if (this.statusTimer) {
          clearTimeout(this.statusTimer);
          this.statusTimer = null;
        }
        if (!message) {
          this.status = { type: "ok", message: "" };
          return;
        }
        this.status = { type, message };
        const duration = type === "err" ? 5000 : 3200;
        this.statusTimer = setTimeout(() => {
          this.status = { type: "ok", message: "" };
          this.statusTimer = null;
        }, duration);
      },
      clearStatus() {
        if (this.statusTimer) {
          clearTimeout(this.statusTimer);
          this.statusTimer = null;
        }
        this.status = { type: "ok", message: "" };
      },
      syncViewFromHash() {
        const hash = (location.hash || "#/").replace(/^#/, "");
        if (hash === "/done" || hash === "done") this.view = "done";
        else if (hash === "/settings" || hash === "settings") this.view = "settings";
        else if (hash === "/calendar" || hash === "calendar") this.view = "calendar";
        else this.view = "active";
      },
      shiftMonth(delta) {
        let year = this.calendarYear;
        let month = this.calendarMonth + delta;
        while (month < 1) {
          month += 12;
          year -= 1;
        }
        while (month > 12) {
          month -= 12;
          year += 1;
        }
        this.calendarYear = year;
        this.calendarMonth = month;
      },
      toggleSort(key) {
        if (this.sortKey === key) {
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        } else {
          this.sortKey = key;
          this.sortDir = key === "seq" || key === "important" ? "desc" : "asc";
        }
        this.page = 1;
      },
      applyDefaultSort() {
        const next = defaultSort(this.partFilter);
        this.sortKey = next.sortKey;
        this.sortDir = next.sortDir;
      },
      sortMark(key) {
        if (this.sortKey !== key) return "";
        return this.sortDir === "asc" ? " ▲" : " ▼";
      },
      goPage(n) {
        const page = Math.max(1, Math.min(this.pageCount, n));
        this.page = page;
      },
      rowStyle(task) {
        if (!task.color) return {};
        return {
          borderLeft: "5px solid " + task.color,
          background: task.color + "14"
        };
      },
      subtaskSummary(task) {
        const list = task.subtasks || [];
        if (!list.length) return "";
        const done = list.filter((item) => item.status === "완료").length;
        return `${done}/${list.length} 완료`;
      },
      detailIsLong(text) {
        if (!text) return false;
        if (text.split("\n").length > 3) return true;
        return text.length > 90;
      },
      requesterOneLine(name) {
        const text = String(name || "").trim();
        return text.length > 0 && text.length <= 4;
      },
      toggleDetail(id) {
        this.expandedId = this.expandedId === id ? null : id;
      },
      async connect() {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        if (this.unsubscribeSettings) {
          this.unsubscribeSettings();
          this.unsubscribeSettings = null;
        }
        const result = await fb.init();
        this.storageMode = result.mode;
        this.db = fb.db;
        if (result.mode === "local") {
          const warnMsg =
            result.reason && result.reason !== "STORAGE_MODE=local"
              ? result.reason + " → 로컬 저장합니다."
              : "";
          this.startLocal(warnMsg);
          return;
        }
        this.currentUser = fb.readSession();
        if (this.currentUser) {
          this.startFirebaseListeners();
        } else {
          this.loading = false;
          this.status = { type: "ok", message: "" };
        }
      },
      startFirebaseListeners() {
        if (!fb.db) {
          this.loading = false;
          this.setStatus("err", "Firebase에 연결되지 않았습니다.");
          return;
        }
        this.loading = true;
        this.unsubscribe = fb.subscribeTasks(
          (rows) => {
            this.tasks = rows.map((row) => normalizeTask(row, row.id));
            this.loading = false;
          },
          (err) => {
            this.loading = false;
            this.tasks = [];
            this.setStatus(
              "err",
              "작업 목록을 불러오지 못했습니다. Firestore 규칙(tasks 읽기)을 확인하세요. " + err.message
            );
          }
        );
        this.unsubscribeSettings = fb.subscribeSettings((data) => {
          if (data && Array.isArray(data.parts) && data.parts.length) {
            this.parts = data.parts;
            localStorage.setItem(LOCAL_PARTS_KEY, JSON.stringify(this.parts));
          }
        });
      },
      async login() {
        const id = (this.loginForm.id || "").trim();
        if (!id) {
          this.loginError = "아이디를 입력하세요.";
          return;
        }
        if (!fb.db) {
          this.loginError = "Firebase에 연결되지 않았습니다.";
          return;
        }
        this.loginBusy = true;
        this.loginError = "";
        try {
          const data = await fb.findUserById(id);
          if (!data) {
            this.loginError = "등록되지 않은 아이디입니다. Firestore user 컬렉션의 id 필드를 확인하세요.";
            return;
          }
          this.currentUser = { id, name: String(data.name || id).trim() };
          fb.writeSession(this.currentUser);
          this.startFirebaseListeners();
        } catch (err) {
          const msg = String(err && err.message ? err.message : err);
          if (/permission|insufficient|Missing or insufficient/i.test(msg)) {
            this.loginError =
              "Firestore 읽기 권한이 없습니다. 규칙에서 user 컬렉션 allow read를 허용하세요.";
          } else if (/index/i.test(msg)) {
            this.loginError = "Firestore 인덱스가 필요합니다. 콘솔 오류 링크에서 인덱스를 생성하세요.";
          } else {
            this.loginError = "로그인 실패: " + msg;
          }
        } finally {
          this.loginBusy = false;
        }
      },
      logout() {
        this.currentUser = null;
        this.loginForm = { id: "" };
        this.loginError = "";
        fb.clearSession();
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        if (this.unsubscribeSettings) {
          this.unsubscribeSettings();
          this.unsubscribeSettings = null;
        }
        this.tasks = [];
        this.status = { type: "ok", message: "" };
      },
      startLocal(message) {
        this.db = null;
        this.storageMode = "local";
        this.currentUser = null;
        this.tasks = readLocalTasks();
        this.parts = readLocalParts();
        this.loading = false;
        this.setStatus(message ? "warn" : "ok", message || "");
      },
      persistParts(parts) {
        fb.saveParts(parts).catch(() => {
          localStorage.setItem(LOCAL_PARTS_KEY, JSON.stringify(parts));
        });
      },
      addPart() {
        const name = this.newPartName.trim();
        const error = partNameError(name);
        if (error) {
          this.setStatus("err", error);
          return;
        }
        if (this.parts.includes(name)) {
          this.setStatus("warn", "이미 있는 파트입니다.");
          return;
        }
        this.parts = [...this.parts, name];
        this.newPartName = "";
        this.persistParts(this.parts);
        this.setStatus("ok", `'${name}' 파트를 추가했습니다.`);
      },
      removePart(name) {
        if (this.parts.length <= 1) {
          this.setStatus("err", "파트는 최소 1개 있어야 합니다.");
          return;
        }
        if (!confirm(`'${name}' 파트를 삭제할까요? 기존 작업의 표시는 유지됩니다.`)) return;
        this.parts = this.parts.filter((part) => part !== name);
        if (this.partFilter === name) this.partFilter = "전체";
        if (this.editingPart === name) this.cancelRenamePart();
        this.persistParts(this.parts);
        this.setStatus("ok", `'${name}' 파트를 삭제했습니다.`);
      },
      startRenamePart(name) {
        this.editingPart = name;
        this.editingPartName = name;
      },
      cancelRenamePart() {
        this.editingPart = null;
        this.editingPartName = "";
      },
      async renamePart(oldName) {
        const next = this.editingPartName.trim();
        const error = partNameError(next);
        if (error) {
          this.setStatus("err", error);
          return;
        }
        if (next === oldName) {
          this.cancelRenamePart();
          return;
        }
        if (this.parts.includes(next)) {
          this.setStatus("warn", "이미 있는 파트 이름입니다.");
          return;
        }
        this.parts = this.parts.map((part) => (part === oldName ? next : part));
        if (this.partFilter === oldName) this.partFilter = next;
        if (this.form.parts.includes(oldName)) {
          this.form.parts = this.form.parts.map((part) => (part === oldName ? next : part));
        }
        const affected = this.tasks.filter((task) => (task.parts || []).includes(oldName));
        this.tasks = this.tasks.map((task) => {
          if (!(task.parts || []).includes(oldName)) return task;
          return {
            ...task,
            parts: task.parts.map((part) => (part === oldName ? next : part)),
            updatedAt: Date.now()
          };
        });
        this.persistParts(this.parts);
        try {
          if (fb.mode === "firebase" && fb.db) {
            await Promise.all(
              affected.map((task) => {
                const updated = this.tasks.find((item) => item.id === task.id);
                return fb.saveTask(task.id, {
                  parts: updated.parts,
                  updatedAt: updated.updatedAt
                });
              })
            );
          } else {
            writeLocalTasks(this.tasks);
          }
          this.cancelRenamePart();
          this.setStatus("ok", `'${oldName}' 파트를 '${next}'(으)로 변경했습니다.`);
        } catch (err) {
          this.setStatus("err", "파트 이름 변경 실패: " + err.message);
        }
      },
      payloadFromForm() {
        const progress = clampProgress(this.form.progress);
        return {
          seq: this.form.seq || this.nextSeq(),
          instructedAt: this.form.instructedAt,
          requester: this.form.requester,
          dueDate: defaultDueDate(this.form.instructedAt, this.form.dueDate),
          progress,
          parts: [...this.form.parts],
          title: normalizeTitle(this.form.title),
          detail: this.form.detail || "",
          color: this.form.color || "",
          important: Boolean(this.form.important),
          subtasks: normalizeSubtasks(this.form.subtasks).filter((item) => item.text.trim()),
          updatedAt: Date.now()
        };
      },
      nextSeq() {
        return this.tasks.reduce((max, t) => Math.max(max, t.seq || 0), 0) + 1;
      },
      openCreate() {
        this.form = this.emptyForm();
        this.requesterOpen = false;
      },
      openEdit(task) {
        this.form = this.emptyForm(task);
        this.requesterOpen = false;
      },
      async completeTask(task) {
        if (!task || task.progress >= 100) return;
        const payload = {
          progress: 100,
          updatedAt: Date.now()
        };
        try {
          if (fb.mode === "firebase" && fb.db) {
            await fb.saveTask(task.id, payload);
          } else {
            this.tasks = this.tasks.map((t) =>
              t.id === task.id ? normalizeTask({ ...t, ...payload }, t.id) : t
            );
            writeLocalTasks(this.tasks);
          }
          this.setStatus("ok", "완료 처리했습니다.");
        } catch (err) {
          this.setStatus("err", "완료 처리 실패: " + err.message);
        }
      },
      onImportantToggle(event) {
        if (event.target.checked) {
          this.form.color = IMPORTANT_TASK_COLOR;
        } else if (this.form.color === IMPORTANT_TASK_COLOR) {
          this.form.color = "";
        }
      },
      closeForm() {
        this.form.open = false;
        this.requesterOpen = false;
      },
      addSubtask() {
        this.form.subtasks.push(newSubtask());
      },
      removeSubtask(index) {
        this.form.subtasks.splice(index, 1);
      },
      pickRequester(name) {
        this.form.requester = name;
        this.requesterOpen = false;
      },
      onRequesterKey(event) {
        const list = this.filteredRequesters;
        if (!this.requesterOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          this.requesterOpen = true;
        }
        if (!list.length) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.requesterIndex = (this.requesterIndex + 1) % list.length;
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          this.requesterIndex = (this.requesterIndex - 1 + list.length) % list.length;
        } else if (event.key === "Enter" && this.requesterOpen) {
          event.preventDefault();
          this.pickRequester(list[this.requesterIndex]);
        } else if (event.key === "Escape") {
          this.requesterOpen = false;
        }
      },
      validateForm() {
        if (!this.form.title) return "작업명을 입력하세요.";
        const name = normalizeTitle(this.form.title);
        const duplicated = this.tasks.some(
          (task) => task.id !== this.form.id && normalizeTitle(task.title) === name
        );
        if (duplicated) return "같은 작업명이 이미 있습니다.";
        if (!this.form.parts.length) return "작업 파트를 하나 이상 선택하세요.";
        return "";
      },
      async saveTask() {
        const error = this.validateForm();
        if (error) {
          this.setStatus("err", error);
          return;
        }
        const payload = this.payloadFromForm();
        try {
          if (fb.mode === "firebase" && fb.db) {
            await fb.saveTask(this.form.id || null, payload);
          } else {
            if (this.form.id) {
              this.tasks = this.tasks.map((t) =>
                t.id === this.form.id ? normalizeTask({ ...t, ...payload }, t.id) : t
              );
            } else {
              const id = "local-" + Date.now();
              this.tasks = [normalizeTask({ ...payload, id, createdAt: Date.now() }, id), ...this.tasks];
            }
            writeLocalTasks(this.tasks);
          }
          this.closeForm();
          this.setStatus(
            "ok",
            payload.progress >= 100 ? "진행률 100%로 완료 목록으로 옮겼습니다." : "저장했습니다."
          );
        } catch (err) {
          this.setStatus("err", "저장 실패: " + err.message);
        }
      },
      async removeTask() {
        if (!this.form.id || !confirm("이 작업을 삭제할까요?")) return;
        try {
          if (fb.mode === "firebase" && fb.db) {
            await fb.deleteTask(this.form.id);
          } else {
            this.tasks = this.tasks.filter((t) => t.id !== this.form.id);
            writeLocalTasks(this.tasks);
          }
          this.closeForm();
          this.setStatus("ok", "삭제했습니다.");
        } catch (err) {
          this.setStatus("err", "삭제 실패: " + err.message);
        }
      },
      async persistImportedTasks(items, replace) {
        if (!items.length) {
          this.setStatus("err", "등록할 데이터가 없습니다.");
          return;
        }
        const known = new Set(
          replace ? [] : this.tasks.map((task) => normalizeTitle(task.title)).filter(Boolean)
        );
        const unique = [];
        let skipped = 0;
        items.forEach((item) => {
          const name = normalizeTitle(item.title);
          if (!name || known.has(name)) {
            skipped += 1;
            return;
          }
          known.add(name);
          unique.push(item);
        });
        if (!unique.length) {
          this.setStatus("warn", `같은 작업명이라 ${skipped}건을 건너뛰었습니다.`);
          return;
        }
        items = unique;
        let seqCursor = replace ? 0 : this.tasks.reduce((max, t) => Math.max(max, t.seq || 0), 0);
        const payloads = items.map((item) => {
          let seq = Number(item.seq) || 0;
          if (!seq) {
            seqCursor += 1;
            seq = seqCursor;
          } else {
            seqCursor = Math.max(seqCursor, seq);
          }
          return {
            seq,
            instructedAt: item.instructedAt || "",
            requester: item.requester || "",
            dueDate: defaultDueDate(item.instructedAt, item.dueDate),
            progress: clampProgress(item.progress),
            parts: Array.isArray(item.parts) ? item.parts : [],
            title: normalizeTitle(item.title),
            detail: item.detail || "",
            color: item.color || "",
            important: Boolean(item.important),
            subtasks: normalizeSubtasks(item.subtasks),
            updatedAt: Date.now()
          };
        });
        if (fb.mode === "firebase" && fb.db) {
          try {
            if (replace) await fb.replaceAllTasks(payloads);
            else await fb.addTasks(payloads);
            this.setStatus(
              "ok",
              skipped
                ? `${payloads.length}건을 등록했습니다. 중복 작업명 ${skipped}건은 건너뛰었습니다.`
                : `${payloads.length}건을 등록했습니다.`
            );
            this.view = "active";
            return;
          } catch (err) {
            /* Firebase 실패 시 로컬로 저장 */
          }
        }
        const mapped = payloads.map((payload, idx) =>
          normalizeTask(
            { ...payload, id: (replace ? "seed-" : "csv-") + Date.now() + "-" + idx, createdAt: Date.now() },
            "csv-" + idx
          )
        );
        this.tasks = replace ? mapped : [...mapped, ...this.tasks];
        writeLocalTasks(this.tasks);
        this.setStatus(
          "ok",
          skipped
            ? `${payloads.length}건을 등록했습니다. 중복 작업명 ${skipped}건은 건너뛰었습니다.`
            : `${payloads.length}건을 등록했습니다.`
        );
        this.view = "active";
      },
      async importCsvFile(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        try {
          const text = decodeFileText(await file.arrayBuffer());
          const items = csvRowsToTasks(parseCsv(text), this.parts);
          if (!items.length) {
            this.setStatus("err", "CSV에서 등록할 작업을 찾지 못했습니다. 첫 행에 컬럼명이 있는지 확인하세요.");
            return;
          }
          await this.persistImportedTasks(items, false);
        } catch (err) {
          this.setStatus("err", "CSV 읽기 실패: " + err.message);
        }
      },
      downloadCsvTemplate() {
        const content = buildCsvTemplate(this.parts);
        downloadTextFile(`작업등록_양식_${todayStamp()}.csv`, content);
        this.setStatus("ok", "CSV 양식을 다운로드했습니다.");
      },
      exportExcel() {
        const partCols = this.excelParts;
        const headers = [
          "순번",
          "작업지시일",
          "작업 요청자",
          "완료예정일",
          "진행률",
          "중요",
          ...partCols.map((part) => "작업파트\n" + part),
          "작업명",
          "세부내용"
        ];
        const aoa = [headers];
        const list = tasksForExport(this.tasks, this.exportModal);
        list.forEach((task) => {
          const subLines = (task.subtasks || [])
            .filter((item) => item.text)
            .map((item) => `  - [${item.status}] ${item.text}`)
            .join("\n");
          const detail = [task.detail, subLines].filter(Boolean).join("\n");
          aoa.push([
            task.seq,
            task.instructedAt,
            task.requester,
            task.dueDate,
            task.progress,
            task.important ? "O" : "",
            ...partCols.map((part) => (task.parts.includes(part) ? "O" : "")),
            task.title,
            detail
          ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [6, 14, 12, 12, 8, 8, ...partCols.map(() => 10), 40, 50].map((wch) => ({ wch }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        XLSX.writeFile(wb, `진행업무_정리_${todayStamp()}.xlsx`);
      },
      openExportModal() {
        this.exportModal = {
          ...blankExportForm(),
          open: true
        };
      },
      closeExportModal() {
        this.exportModal.open = false;
      },
      setExportPartMode(mode) {
        this.exportModal.partMode = mode;
        if (mode === "all") this.exportModal.selectedParts = [];
      },
      toggleExportPart(part) {
        const selected = this.exportModal.selectedParts;
        const idx = selected.indexOf(part);
        if (idx >= 0) selected.splice(idx, 1);
        else selected.push(part);
      },
      isExportPartSelected(part) {
        return this.exportModal.selectedParts.includes(part);
      },
      confirmExportExcel() {
        const modal = this.exportModal;
        if (modal.periodMode === "range") {
          if (!modal.dateFrom || !modal.dateTo) {
            this.setStatus("warn", "기간의 시작일과 종료일을 선택하세요.");
            return;
          }
          if (modal.dateFrom > modal.dateTo) {
            this.setStatus("warn", "시작일이 종료일보다 늦을 수 없습니다.");
            return;
          }
        }
        if (modal.partMode === "part" && !modal.selectedParts.length) {
          this.setStatus("warn", "추출할 파트를 하나 이상 선택하세요.");
          return;
        }
        const list = tasksForExport(this.tasks, modal);
        if (!list.length) {
          this.setStatus("warn", "조건에 맞는 작업이 없습니다.");
          return;
        }
        this.exportExcel();
        this.closeExportModal();
        this.setStatus("ok", `${list.length}건을 다운로드했습니다.`);
      }
    }
  }).mount("#app");
})();
