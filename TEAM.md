# Cara Connect ke SEO MCP (GSC + GA4)

Server: `https://mcpseotest.revincolabs.com/mcp`

Kamu butuh **token** pribadimu (minta ke admin). Pilih cara sesuai aplikasi
Claude yang kamu pakai.

> Pilih **A** (Claude Code), **B** (Desktop), atau **C** (browser claude.ai).
> Cara A & B pakai token pribadimu sebagai header. Cara C lewat OAuth: kamu
> tidak menempel token, tapi mengetik password/token sekali di layar consent.

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

## C. Browser claude.ai (OAuth)

Server ini sudah punya OAuth sendiri, jadi "Add custom connector" di browser
kini jalan. Kamu **tidak** memasukkan token sebagai header — cukup ketik
password tim / token pribadimu di layar consent yang muncul.

1. Buka menu Connectors:
   - **Team/Enterprise:** Admin settings → **Connectors** → **Add custom connector**
     (harus Owner; member lalu klik **Connect**).
   - **Free/Pro/Max:** Settings → **Connectors** → **Add custom connector**.
2. **URL:** `https://mcpseotest.revincolabs.com/mcp`
3. Buka **Pengaturan lanjutan** dan **biarkan OAuth Client ID & Secret KOSONG**
   (Claude mendaftar sendiri otomatis). Klik **Tambahkan**.
4. Klik **Connect**. Akan terbuka **layar consent milik server** bertuliskan
   _"Sambungkan ke SEO MCP"_.
5. Masukkan **password tim** (dari admin) **atau token pribadimu**, klik
   **Setujui & sambungkan**. Kamu akan diarahkan balik ke claude.ai, tersambung.
6. Aktifkan di chat lewat tombol **"+"** → Connectors.

> Layar consent hanya muncul kalau OAuth sudah diaktifkan di server
> (admin mengeset `MCP_PUBLIC_URL` + `MCP_OAUTH_JWT_SECRET`). Kalau belum,
> pakai cara A/B dulu.

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
| "Add connector" di browser error "tidak dapat mendaftar" | OAuth belum aktif di server. Admin set `MCP_PUBLIC_URL` + `MCP_OAUTH_JWT_SECRET`, lalu ulangi cara **C**. |
| Cara C: layar consent bilang "password/token salah" | Masukkan `MCP_OAUTH_PASSWORD` atau salah satu token di `MCP_AUTH_TOKENS`. Minta ke admin. |
| Cara C: OAuth Client ID/Secret diminta wajib | Jangan diisi — biarkan kosong. Klik Tambahkan saja. |
