# Cara Connect ke SEO MCP (GSC + GA4)

Server: `https://mcpseotest.revincolabs.com/mcp`

Kamu butuh **token** pribadimu (minta ke admin). Pilih cara sesuai aplikasi
Claude yang kamu pakai.

> ⚠️ **JANGAN** pakai tombol "Add custom connector" di browser claude.ai —
> itu wajib OAuth dan tidak akan jalan dengan token kita. Pakai salah satu cara
> di bawah.

---

## A. Claude Code (CLI)

Jalankan di terminal (ganti `TOKEN_KAMU`):

```bash
claude mcp add --transport http seo https://mcpseotest.revincolabs.com/mcp \
  --header "Authorization: Bearer TOKEN_KAMU"
```

Cek berhasil:
```bash
claude mcp list
```

Hapus kalau perlu:
```bash
claude mcp remove seo
```

---

## B. Claude Desktop (aplikasi Windows/Mac)

**Prasyarat:** Node.js terinstall (https://nodejs.org — versi LTS).
Cek: buka terminal, ketik `node -v` → harus muncul nomor versi.

1. Buka Claude Desktop → **Settings** → **Developer** → **Edit Config**.
   (Ini membuka file `claude_desktop_config.json`.)
2. Isi seperti ini (kalau sudah ada `mcpServers`, tambahkan blok `seo` saja).
   Ganti `TOKEN_KAMU`:

```json
{
  "mcpServers": {
    "seo": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcpseotest.revincolabs.com/mcp",
        "--header",
        "Authorization: Bearer TOKEN_KAMU"
      ]
    }
  }
}
```

3. **Simpan file**, lalu **tutup Claude Desktop sepenuhnya dan buka lagi**
   (bukan cuma close window — keluar total dari tray/taskbar).
4. Setelah restart, ikon tools (🔨) akan muncul di kotak chat. Server `seo` siap.

> Windows: kalau `npx` tidak dikenali, restart PC setelah install Node.js.

---

## Cara pakai (contoh prompt)

Setelah connect, tanya Claude natural language:

- "List our Search Console sites."
- "Untuk `sc-domain:revincolabs.com`, top 20 query berdasarkan clicks 28 hari terakhir."
- "GA4: active users & sessions per country, 7 hari terakhir, property 123456789."
- "Berapa realtime active users sekarang di property 123456789?"
- "List GA4 properties yang tersedia."

Tools yang tersedia:
`gsc_list_sites`, `gsc_search_analytics`, `ga4_list_properties`,
`ga4_run_report`, `ga4_realtime_report`, `ga4_get_metadata`.

---

## Troubleshooting

| Masalah | Solusi |
|--------|--------|
| `401 Unauthorized` | Token salah/kurang. Cek `Authorization: Bearer` dan token kamu. |
| Data kosong / error permission | Service account belum ditambahkan ke properti GSC/GA4 itu. Hubungi admin. |
| Claude Desktop: server tidak muncul | Pastikan Node.js terinstall, JSON valid (tidak ada koma nyasar), lalu restart total. |
| "Add connector" di browser gagal | Memang tidak didukung — pakai cara A atau B di atas. |
