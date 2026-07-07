import express, { text } from 'express'
import {tavily } from '@tavily/core'
import { Output, streamText } from 'ai'
import { PROPMT_TEMPLATE, SYSTEM_PROMPT } from './prompt'
import {string, z} from "zod"

const client = tavily({apiKey:process.env.TAVILY_API_KEY})

const app = express()
app.use(express.json())

app.post("/perplexity_ask", async(req,res)=>{
//step 1: get the web search results and the query from the frontend

const query = req.body.query

// step 4: websearch to gather the informations
const websearchResponse = await  client.search(query,{
    searchDepth:"advanced"
})

const websearchResults = websearchResponse.results

// step 6: hit the LLM and stream back to the response 

const prompt = PROPMT_TEMPLATE.replace('{{WEB_SEARCH_RESULTS}}',JSON.stringify(websearchResults)).replace('{{USER_QUERY}}',query)
const result = streamText({
    model: 'openai/gpt-5.4',
    prompt:prompt,
    system:SYSTEM_PROMPT,
   
  });

res.header('Cache-control','no-cache')
res.header('Content-Type','text/event-stream')
  for await (const textPart of result.textStream){
   res.write(textPart);
  }
res.write("\n<SOURCES>\n")

// step 7 : stream back the sourcs and the follow up the questions [which we asked]
res.write(JSON.stringify(websearchResults.map(result => result.url)))

res.write("\n</SOURCES>\n")
// step 8:END
res.end()
})

app.post("/perplexity_ask/followups", async(req,res)=>{
  const{query,sources} = req.body
  const websearchResponse = await client.search(query,{searchDepth:sources})
  const websearchResult = websearchResponse.results
  const prompt = PROPMT_TEMPLATE.replace('{{WEB_SEARCH_RESULTS}}',JSON.stringify(websearchResult)).replace('{{USER_QUERY}}',query)
const result = streamText({
    model: 'openai/gpt-5.4',
    prompt:prompt,
    system:SYSTEM_PROMPT,
   
  });
  res.header('Cache-control','no-cache')
res.header('Content-Type','text/event-stream')
  for await (const textPart of result.textStream){
   res.write(textPart);
  }

})
app.listen(3000)