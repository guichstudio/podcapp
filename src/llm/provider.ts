export interface ChatRequest {
  model: string
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
}

export interface ChatResponse {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface ChatProvider {
  chat(req: ChatRequest): Promise<ChatResponse>
}
