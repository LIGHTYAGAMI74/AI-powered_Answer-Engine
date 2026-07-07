import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { tavily } from '@tavily/core'
import { streamText } from 'ai'
import { PROPMT_TEMPLATE, SYSTEM_PROMPT } from './prompt'
import { z } from 'zod'
import { prisma } from './db'


const client = tavily({ apiKey: process.env.TAVILY_API_KEY })

const app = express()
app.use(express.json())
app.use(cors())


const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_perplexity_key_123'

// Middleware to protect routes and verify JWT
const authMiddleware = (req:any,res:any,next:any) => {

  const token = req.cookies.token
  if(!token){
    return res.status(403).json({
      message:"token is not verfied"
    })
  }
  try{
    const decoded:any = jwt.verify(token,JWT_SECRET)
    req.userId = decoded.userId

   
    next()
  }catch{
    return res.status(403).json({
      message:"invalid token"
    })
  }
}

// Validation schemas
const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  provider: z.enum(['google', 'github']),
})

const loginSchema = z.object({
  email: z.string().email(),
  provider: z.enum(['google', 'github']),
})

// Auth endpoints
app.post('/signup', async (req, res) => {
  try {
    const body = signupSchema.parse(req.body)

    let user = await prisma.user.findFirst({
      where: {
        email: body.email,
        provider: body.provider,
      },
    })

    if (user) {
      res.status(400).json({ error: 'User already exists with this email and provider.' })
      return
    }

    user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        provider: body.provider,
      },
    })

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: '7d',
    })

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error })
      return
    }
    console.error('Signup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/login', async (req, res) => {
  try {
    const body = loginSchema.parse(req.body)

    const user = await prisma.user.findFirst({
      where: {
        email: body.email,
        provider: body.provider,
      },
    })

    if (!user) {
      res.status(401).json({ error: 'Invalid email or provider. User does not exist.' })
      return
    }

    const token = jwt.sign({ userId: user.id}, JWT_SECRET, {
      expiresIn: '7d',
    })
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })

    res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error })
      return
    }
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider,
      },
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/perplexity_ask', authMiddleware, async (req, res) => {
  //step 1: get the web search results and the query from the frontend
  const query = req.body.query

  // step 4: websearch to gather the informations
  const websearchResponse = await client.search(query, {
    searchDepth: 'advanced',
  })

  const websearchResults = websearchResponse.results

  // step 6: hit the LLM and stream back to the response
  const prompt = PROPMT_TEMPLATE.replace('{{WEB_SEARCH_RESULTS}}', JSON.stringify(websearchResults)).replace('{{USER_QUERY}}', query)
  const result = streamText({
    model: 'openai/gpt-5.4',
    prompt: prompt,
    system: SYSTEM_PROMPT,
  })

  res.header('Cache-control', 'no-cache')
  res.header('Content-Type', 'text/event-stream')
  for await (const textPart of result.textStream) {
    res.write(textPart)
  }
  res.write('\n<SOURCES>\n')

  // step 7 : stream back the sourcs and the follow up the questions [which we asked]
  res.write(JSON.stringify(websearchResults.map((result) => result.url)))

  res.write('\n</SOURCES>\n')
  // step 8:END
  res.end()
})

app.post('/perplexity_ask/followups', authMiddleware, async (req, res) => {
  const { query, sources } = req.body
  const websearchResponse = await client.search(query, { searchDepth: sources })
  const websearchResult = websearchResponse.results
  const prompt = PROPMT_TEMPLATE.replace('{{WEB_SEARCH_RESULTS}}', JSON.stringify(websearchResult)).replace('{{USER_QUERY}}', query)
  const result = streamText({
    model: 'openai/gpt-5.4',
    prompt: prompt,
    system: SYSTEM_PROMPT,
  })
  res.header('Cache-control', 'no-cache')
  res.header('Content-Type', 'text/event-stream')
  for await (const textPart of result.textStream) {
    res.write(textPart)
  }
})

app.listen(3000, () => {
  console.log('Server is running on port 3000')
})