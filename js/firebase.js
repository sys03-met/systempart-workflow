(() => {
  const SESSION_KEY = "systempart.session";
  const LOCAL_PARTS_KEY = "systempart.parts";

  function parseDotEnv(text) {
    const out = {};
    String(text || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const eq = trimmed.indexOf("=");
        if (eq < 0) return;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        out[key] = val;
      });
    return out;
  }

  function envToFirebase(env) {
    return {
      apiKey: env.FIREBASE_API_KEY || "",
      authDomain: env.FIREBASE_AUTH_DOMAIN || "",
      projectId: env.FIREBASE_PROJECT_ID || "",
      storageBucket: env.FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || "",
      appId: env.FIREBASE_APP_ID || ""
    };
  }

  function isConfigReady(config) {
    return Boolean(config && config.apiKey && config.projectId);
  }

  function resolveStorageMode(env) {
    const mode = String(env.STORAGE_MODE || env.STORAGE || "").trim().toLowerCase();
    if (mode === "local" || mode === "firebase") return mode;
    return isConfigReady(envToFirebase(env)) ? "firebase" : "local";
  }

  async function loadEnv() {
    const env = Object.assign({}, window.APP_ENV || {});
    try {
      const res = await fetch("./.env", { cache: "no-store" });
      if (res.ok) Object.assign(env, parseDotEnv(await res.text()));
    } catch {
      /* file:// 이거나 .env가 없으면 js/env.js 값을 씁니다. */
    }
    return env;
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const user = raw ? JSON.parse(raw) : null;
      if (user && user.id && user.name) return user;
    } catch {
      /* ignore */
    }
    return null;
  }

  function writeSession(user) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function createFirebaseApi() {
    let db = null;
    let mode = "local";

    return {
      get mode() {
        return mode;
      },
      get db() {
        return db;
      },
      async init() {
        const env = await loadEnv();
        mode = resolveStorageMode(env);
        db = null;
        if (mode !== "firebase") {
          return { mode: "local", reason: "STORAGE_MODE=local" };
        }
        const config = envToFirebase(env);
        if (!isConfigReady(config)) {
          mode = "local";
          return { mode: "local", reason: "Firebase 키 없음" };
        }
        try {
          if (!firebase.apps.length) firebase.initializeApp(config);
          db = firebase.firestore();
          mode = "firebase";
          return { mode: "firebase", reason: "" };
        } catch (err) {
          mode = "local";
          db = null;
          return { mode: "local", reason: "초기화 실패: " + err.message };
        }
      },
      readSession,
      writeSession,
      clearSession,
      async findUserById(id) {
        if (!db) throw new Error("Firebase에 연결되지 않았습니다.");
        const byField = await db.collection("user").where("id", "==", id).get();
        if (!byField.empty) return byField.docs[0].data() || {};
        const byDoc = await db.collection("user").doc(id).get();
        if (byDoc.exists) return byDoc.data() || {};
        return null;
      },
      subscribeTasks(onData, onError) {
        if (!db) return () => {};
        return db.collection("tasks").onSnapshot(
          (snap) => {
            onData(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
          },
          onError
        );
      },
      subscribeSettings(onData) {
        if (!db) return () => {};
        return db
          .collection("settings")
          .doc("app")
          .onSnapshot(
            (doc) => onData(doc.exists ? doc.data() : null),
            () => {}
          );
      },
      async saveParts(parts) {
        localStorage.setItem(LOCAL_PARTS_KEY, JSON.stringify(parts));
        if (!db) return;
        await db.collection("settings").doc("app").set({ parts }, { merge: true });
      },
      async saveTask(id, payload) {
        if (!db) throw new Error("Firebase에 연결되지 않았습니다.");
        if (id) {
          await db.collection("tasks").doc(id).update(payload);
          return id;
        }
        const ref = await db.collection("tasks").add({
          ...payload,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return ref.id;
      },
      async deleteTask(id) {
        if (!db) throw new Error("Firebase에 연결되지 않았습니다.");
        await db.collection("tasks").doc(id).delete();
      },
      async replaceAllTasks(payloads) {
        if (!db) throw new Error("Firebase에 연결되지 않았습니다.");
        const batch = db.batch();
        const existing = await db.collection("tasks").get();
        existing.forEach((doc) => batch.delete(doc.ref));
        payloads.forEach((payload) => {
          batch.set(db.collection("tasks").doc(), {
            ...payload,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      },
      async addTasks(payloads) {
        if (!db) throw new Error("Firebase에 연결되지 않았습니다.");
        const batch = db.batch();
        payloads.forEach((payload) => {
          batch.set(db.collection("tasks").doc(), {
            ...payload,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      }
    };
  }

  window.AppFirebase = createFirebaseApi();
})();
