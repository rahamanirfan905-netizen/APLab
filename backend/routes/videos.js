const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')

const videosFile = path.join(__dirname, '..', 'data', 'videos.json')
const sampleData = require('../data/sampleData')
const historyFile = path.join(__dirname, '..', 'data', 'watchHistory.json')

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function ensureVideosFile() {
  const existing = readJSON(videosFile)
  if (!existing || !Array.isArray(existing) || existing.length === 0) {
    // seed from sampleData
    const seeded = sampleData.map((v) => {
      const id = generateId()
      return {
        _id: id,
        title: v.title,
        description: v.description,
        videoUrl: v.videoUrl,
        localFile: v.localFile,
        thumbnail: v.thumbnail,
        likes: v.likes || 0,
        views: v.views || 0,
        comments: (v.comments || []).map((c) => ({ _id: generateId(), author: c.author, text: c.text, createdAt: new Date().toISOString() })),
        createdAt: new Date().toISOString()
      }
    })
    writeJSON(videosFile, seeded)
    return seeded
  }
  return existing
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function readHistory() {
  try {
    const raw = fs.readFileSync(historyFile, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return []
  }
}

function writeHistory(arr) {
  fs.writeFileSync(historyFile, JSON.stringify(arr, null, 2))
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.ogg') return 'video/ogg'
  return 'application/octet-stream'
}

// Ensure videos file exists on startup
ensureVideosFile()


// POST /api/videos/seed - overwrite videos.json with sampleData (dev)
router.post('/seed', (req, res) => {
  try {
    const seeded = sampleData.map((v) => ({
      _id: generateId(),
      title: v.title,
      description: v.description,
      videoUrl: v.videoUrl,
      localFile: v.localFile,
      thumbnail: v.thumbnail,
      likes: v.likes || 0,
      views: v.views || 0,
      comments: (v.comments || []).map((c) => ({ _id: generateId(), author: c.author, text: c.text, createdAt: new Date().toISOString() })),
      createdAt: new Date().toISOString()
    }))
    writeJSON(videosFile, seeded)
    res.json({ ok: true, inserted: seeded.length })
  } catch (err) {
    console.error('Seed failed', err)
    res.status(500).json({ error: 'Seed failed' })
  }
})



// GET /api/videos/stream/:id
router.get('/stream/:id', (req, res) => {
  const id = req.params.id
  const videos = readJSON(videosFile) || []
  const video = videos.find((x) => x._id === id)
  if (!video) return res.status(404).json({ error: 'Not found' })
  if (!video.localFile) return res.status(404).json({ error: 'No local file available' })

  const videoPath = path.join(__dirname, '..', 'media', path.basename(video.localFile))
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'File not found' })

  const { size } = fs.statSync(videoPath)
  const range = req.headers.range
  const contentType = getMimeType(videoPath)

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1
    if (isNaN(start) || isNaN(end) || start > end || end >= size) {
      res.status(416).set({ 'Content-Range': `bytes */${size}` }).send('Requested range not satisfiable')
      return
    }

    const chunkSize = end - start + 1
    const stream = fs.createReadStream(videoPath, { start, end })
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    })
    stream.pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    })
    fs.createReadStream(videoPath).pipe(res)
  }
})

// GET /api/videos - list (supports ?title=)
router.get('/', (req, res) => {
  const videos = readJSON(videosFile) || []
  const titleQuery = (req.query.title || '').trim().toLowerCase()

  if (!titleQuery) {
    return res.json(videos)
  }

  const filtered = videos.filter((video) =>
    (video.title || '').toLowerCase().includes(titleQuery)
  )

  return res.json(filtered)
})

// GET /api/videos/:id
router.get('/:id', (req, res) => {
  const videos = readJSON(videosFile) || []
  const video = videos.find((item) => item._id === req.params.id)

  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  video.views = Number(video.views || 0) + 1
  writeJSON(videosFile, videos)
  return res.json(video)
})

// PUT /api/videos/:id/like  { like: true }
router.put('/:id/like', (req, res) => {
  const videos = readJSON(videosFile) || []
  const video = videos.find((item) => item._id === req.params.id)

  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  const { like } = req.body || {}
  if (typeof like !== 'boolean') {
    return res.status(400).json({ error: 'Request body must include a boolean like value' })
  }

  video.likes = Math.max(0, Number(video.likes || 0) + (like ? 1 : -1))
  writeJSON(videosFile, videos)
  return res.json({ likes: video.likes })
})

// PUT /api/videos/:id/comments  { author, text }
router.put('/:id/comments', (req, res) => {
  const videos = readJSON(videosFile) || []
  const video = videos.find((item) => item._id === req.params.id)

  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  const { author, text } = req.body || {}
  if (!author || !text) {
    return res.status(400).json({ error: 'author and text are required' })
  }

  const comment = {
    _id: generateId(),
    author: String(author).trim(),
    text: String(text).trim(),
    createdAt: new Date().toISOString()
  }

  video.comments = Array.isArray(video.comments) ? [...video.comments, comment] : [comment]
  writeJSON(videosFile, videos)
  return res.json(video.comments)
})

// GET /api/videos/:id/likes
router.get('/:id/likes', (req, res) => {
  const videos = readJSON(videosFile) || []
  const video = videos.find((item) => item._id === req.params.id)

  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  return res.json({ likes: Number(video.likes || 0) })
})

// GET /api/videos/:id/comments
router.get('/:id/comments', (req, res) => {
  const videos = readJSON(videosFile) || []
  const video = videos.find((item) => item._id === req.params.id)

  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  return res.json(Array.isArray(video.comments) ? video.comments : [])
})

// GET /api/videos/watch-history — Get watch history
router.get('/watch-history', (req, res) => {
  return res.json(readHistory())
})

// POST /api/videos/watch-history — Add to history
router.post('/watch-history', (req, res) => {
  const { videoId } = req.body || {}
  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' })
  }

  const history = readHistory()
  history.push({ videoId, watchedAt: new Date().toISOString() })
  writeHistory(history)

  return res.status(201).json(history)
})

// DELETE /api/videos/watch-history — Clear history
router.delete('/watch-history', (req, res) => {
  writeHistory([])
  return res.json({ ok: true, cleared: true })
})

module.exports = router
