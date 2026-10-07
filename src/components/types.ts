// Shapes the API returns (dates arrive as ISO strings).

export interface ClientMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ClientConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
