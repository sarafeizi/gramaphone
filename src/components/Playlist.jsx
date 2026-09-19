import React, {
  useState, useEffect, useRef, useCallback,
} from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Dropdown } from "primereact/dropdown";
import WaveformPlayer from "./Player";
import {
  saveSongBlob, loadSongBlob, deleteSongBlob, listAllSongIds,
} from "./songStorage";
import "./Playlist.css";

const STORAGE_KEY = "my_playlist_songs";

export default function Playlist() {
  /* ---------- حالت روشن/تاریک ---------- */
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("theme") === "dark",
  );
  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [activeCategory, setActiveCategory] = useState("all");
  const [repeatMode, setRepeatMode] = useState(false);

  const [contextMenu, setContextMenu] = useState(null);

  const fileInputRef = useRef(null);
  const wavePlayerRef = useRef(null);
  const firstRun = useRef(true);

  /* ---------- بارگذاری اولیه ---------- */
  useEffect(() => {
    (async () => {
      let remote = [];
      try {
        remote = JSON.parse(localStorage.getItem(STORAGE_KEY))?.filter(Boolean) || [];
      } catch { }
      const ids = await listAllSongIds();
      const local = [];
      for (const id of ids) {
        const meta = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-${id}`) || "null");
        if (!meta) continue;
        const blob = await loadSongBlob(id);
        if (!blob) continue;
        local.push({ ...meta, url: URL.createObjectURL(blob), isLocalFile: true });
      }
      setSongs([...remote, ...local]);
    })();
  }, []);

  /* ---------- ذخیره تغییرات لیست ---------- */
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const nonLocal = songs.filter((s) => !s.isLocalFile);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nonLocal));
  }, [songs]);

  /* ---------- دسته‌بندی‌ها ---------- */
  const fixedCategories = ["پاپ", "سنتی", "راک", "الکترونیک"];
  const dynamicCategories = Array.from(new Set(songs.map((s) => s.category).filter(Boolean)));
  const categoriesForMenu = Array.from(new Set([...fixedCategories, ...dynamicCategories]));
  const categoryOptions = [
    { label: "همهٔ دسته‌ها", value: "all" },
    ...categoriesForMenu.map((c) => ({ label: c, value: c })),
  ];

  /* ---------- جست‌وجوی iTunes ---------- */
  useEffect(() => {
    if (!searchTerm.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&limit=50&country=us`)
      .then((r) => r.json())
      .then(({ results }) => setSearchResults(results.map((i) => ({
        id: i.trackId, title: i.trackName, url: i.previewUrl,
        artist: i.artistName, artwork: i.artworkUrl60, isPreview: true, category: null,
      }))))
      .catch(() => setSearchResults([]))
      .finally(() => setIsSearching(false));
  }, [searchTerm]);

  /* ---------- افزودن ---------- */
  const handleAddFromSearch = (song) => {
    if (songs.some((x) => x.id === song.id)) return alert("این آهنگ قبلاً اضافه شده است!");
    setSongs((p) => [...p, { ...song, isPreview: false }]);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const id = Date.now();
    await saveSongBlob(id, file);
    localStorage.setItem(`${STORAGE_KEY}-${id}`, JSON.stringify({ id, title: file.name, category: null }));
    setSongs((p) => [...p, { id, title: file.name, url: URL.createObjectURL(file), category: null, isLocalFile: true }]);
    e.target.value = null;
  };

  /* ---------- حذف ---------- */
  const handleRemove = async (id) => {
    setSongs((p) => p.filter((s) => s.id !== id));
    localStorage.removeItem(`${STORAGE_KEY}-${id}`);
    await deleteSongBlob(id);
    if (currentSong?.id === id) setCurrentSong(null);
  };

  /* ---------- Drag & Drop ---------- */
  const onDragEnd = (res) => {
    if (!res.destination) return;
    const list = Array.from(songs);
    const [moved] = list.splice(res.source.index, 1);
    list.splice(res.destination.index, 0, moved);
    setSongs(list);
  };

  /* ---------- کنترل پخش ---------- */
  const findIdx = useCallback(() => songs.findIndex((s) => s.id === currentSong?.id), [songs, currentSong]);

  const handleNext = useCallback((auto = false) => {
    if (!currentSong || songs.length === 0) return;
    const idx = findIdx(); if (idx === -1) return;
    setCurrentSong(songs[(idx + 1) % songs.length]);
    auto && wavePlayerRef.current?.play();
  }, [currentSong, songs, findIdx]);

  const handlePrev = useCallback((auto = false) => {
    if (!currentSong || songs.length === 0) return;
    const idx = findIdx(); if (idx === -1) return;
    setCurrentSong(songs[(idx - 1 + songs.length) % songs.length]);
    auto && wavePlayerRef.current?.play();
  }, [currentSong, songs, findIdx]);

  const onSongFinish = () => {
    if (currentSong?.isPreview) return;
    repeatMode ? wavePlayerRef.current?.play() : handleNext(true);
  };

  /* ---------- کلیدهای میانبر ---------- */
  useEffect(() => {
    const h = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); wavePlayerRef.current?.togglePlay(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); handleNext(true); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); handlePrev(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleNext, handlePrev]);

  /* ---------- پخش خودکار هنگام تعویض آهنگ ---------- */
  useEffect(() => { currentSong && wavePlayerRef.current?.play(); }, [currentSong]);

  /* ---------- لیست قابل‌نمایش ---------- */
  const visible = activeCategory === "all" ? songs : songs.filter((s) => s.category === activeCategory);

  /* ---------- UI ---------- */
  return (
    <div className="playlist-container" onClick={() => setContextMenu(null)}>
      <h1
        style={{
          fontSize: "2.2em",
          lineHeight: "1.1",
          textAlign: "start",
        }}
      >
        🎧 موزیک پلیر
      </h1>
      {/* تم */}
      <div className="header">
        <button className="theme-toggle" onClick={() => setDarkMode((p) => !p)}>
          {darkMode ? "🌞 روشن" : "🌙 تاریک"}
        </button>
      </div>

      {/* جستجو */}
      <input
        className="search-input"
        placeholder="جستجوی آهنگ در iTunes..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      {isSearching && <p>… در حال جستجو</p>}

      {/* نتایج جستجو */}
      {!isSearching && !!searchResults.length && (
        <>
          <p dir="rtl" style={{ fontSize: 13, color: "var(--subtext)", marginBottom: 6, textAlign: "right" }}>
            ⚠️  نسخه کامل در دسترس نیست، فقط ۳۰ ثانیه از طریق iTunes پخش می‌شود.
          </p>
          <h3>نتایج جستجو</h3>
          <ul className="search-results">
            {searchResults.map((s) => (
              <li key={s.id} className="result-item">
                <img src={s.artwork} alt=""  />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="song-title">{s.title}</div>
                  <div className="artist">{s.artist}</div>
                </div>
                <div className="song-controls" style={{ marginLeft: 10 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn play-btn" onClick={() => setCurrentSong(s)} title="پخش">▶️</button>
                  <button className="btn add-btn" onClick={() => handleAddFromSearch(s)} title="افزودن">➕</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* فیلتر دسته */}
      <div style={{ marginTop: 30, width: 220 }}>
        <label style={{ marginBottom: 4 }}>فیلتر دسته:</label>
        <Dropdown
          value={activeCategory}
          onChange={(e) => setActiveCategory(e.value)}
          options={categoryOptions}
          placeholder="انتخاب دسته" style={{ marginRight: 4 }}
          className={`p-dropdown-sm rtl-dropdown ${darkMode ? "p-input-filled" : ""}`}
        />
      </div>

      {/* لیست آهنگ‌ها */}
      <h3 style={{ marginTop: 20 }}>پلی‌لیست (Drag & Drop)</h3>
      {songs.length === 0 ? (
        <p>آهنگی برای این حالت نیست.</p>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="songs">
            {(p) => (
              <ul ref={p.innerRef} {...p.droppableProps} className="playlist-ul">
                {visible.map((s, i) => (
                  <Draggable key={s.id} draggableId={String(s.id)} index={i}>
                    {(pr, snap) => (
                      <li
                        ref={pr.innerRef} {...pr.draggableProps} {...pr.dragHandleProps}
                        className={`song-item ${snap.isDragging ? "dragging" : ""} ${currentSong?.id === s.id ? "selected" : ""}`}
                        onClick={() => setCurrentSong(s)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, songId: s.id }); }}
                      >
                        <span className="song-title">
                          {s.title}{" "}
                          {s.category && <span style={{ fontSize: 11, color: "var(--subtext)" }}>({s.category})</span>}
                        </span>
                        <div className="song-controls" onClick={(e) => e.stopPropagation()}>
                          <button className="btn play-btn" onClick={() => setCurrentSong(s)} title="پخش">▶️</button>
                          <button className="btn remove-btn" onClick={() => handleRemove(s.id)} title="حذف">❌</button>
                        </div>
                      </li>
                    )}
                  </Draggable>
                ))}
                {p.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* منوی راست‌کلیک */}
      {contextMenu && (
        <ul
          className={`context-menu ${darkMode ? "dark" : "light"}`}
          style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 1e4 }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {categoriesForMenu.map((cat) => (
            <li key={cat} onClick={() => {
              setSongs((p) => p.map((x) => x.id === contextMenu.songId ? { ...x, category: cat } : x));
              const metaKey = `${STORAGE_KEY}-${contextMenu.songId}`;
              const meta = JSON.parse(localStorage.getItem(metaKey) || "null");
              if (meta) localStorage.setItem(metaKey, JSON.stringify({ ...meta, category: cat }));
              setContextMenu(null);
            }}>{cat}</li>
          ))}
          <li onClick={() => {
            setSongs((p) => p.map((x) => x.id === contextMenu.songId ? { ...x, category: null } : x));
            const metaKey = `${STORAGE_KEY}-${contextMenu.songId}`;
            const meta = JSON.parse(localStorage.getItem(metaKey) || "null");
            if (meta) localStorage.setItem(metaKey, JSON.stringify({ ...meta, category: null }));
            setContextMenu(null);
          }}>بدون دسته</li>
        </ul>
      )}

      {/* افزودن از کامپیوتر */}
      <div className="add-box" onDoubleClick={() => fileInputRef.current?.click()}>
        ➕ افزودن آهنگ از کامپیوتر (دوبار کلیک)
      </div>
      <input type="file" accept="audio/*" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />

      {/* پلیر پایین صفحه */}
      {currentSong && (
        <div className="player-fixed">
          <strong>در حال پخش: {currentSong.title}</strong>
          <WaveformPlayer ref={wavePlayerRef} url={currentSong.url} darkMode={darkMode} onFinish={onSongFinish} />
          <div className="player-controls">
            <button onClick={() => handlePrev(true)} title="قبلی">⏮</button>
            <button onClick={() => wavePlayerRef.current?.togglePlay()} title="پخش/توقف">⏯</button>
            <button onClick={() => handleNext(true)} title="بعدی">⏭</button>
            <button onClick={() => setRepeatMode((p) => !p)} style={{ color: repeatMode ? "red" : "black" }} title="تکرار">🔁</button>
          </div>
        </div>
      )}
    </div>
  );
}
