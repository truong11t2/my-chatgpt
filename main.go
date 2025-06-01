package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

type Message struct {
	Content string `json:"content"`
	Role    string `json:"role"`
	Type    string `json:"type,omitempty"`
	File    *File  `json:"file,omitempty"`
}

type File struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Type    string `json:"type"`
}

type DeepSeekRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

type DeepSeekResponse struct {
	Choices []struct {
		Message Message `json:"message"`
		Delta   struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func main() {

	// // Get the path where the binary is running
	// exePath, err := os.Executable()
	// if err != nil {
	// 	log.Fatal(err)
	// }
	// dir := filepath.Dir(exePath)
	// dotenvPath := filepath.Join(dir, ".env")
	// log.Println("Trying to load:", dotenvPath)

	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	apiKey := os.Getenv("DEEPSEEK_API_KEY")
	baseURL := os.Getenv("DEEPSEEK_BASE_URL")
	model := os.Getenv("DEEPSEEK_MODEL")

	if apiKey == "" {
		log.Fatal("DEEPSEEK_API_KEY environment variable is required")
	}
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	if model == "" {
		model = "deepseek-chat"
	}

	// Create uploads directory if it doesn't exist
	uploadsDir := "uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		log.Fatal("Failed to create uploads directory:", err)
	}

	r := gin.Default()

	// Serve static files
	r.Static("/static", "./static")
	r.Static("/uploads", "./uploads")
	r.LoadHTMLGlob("templates/*")

	// WebSocket endpoint
	r.GET("/ws", func(c *gin.Context) {
		log.Println("New WebSocket connection request received")

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Println("Failed to upgrade connection:", err)
			return
		}
		defer conn.Close()

		log.Println("WebSocket connection established")

		// Store conversation history
		var conversation []Message

		for {
			var msg Message
			err := conn.ReadJSON(&msg)
			if err != nil {
				log.Println("Error reading message:", err)
				break
			}

			log.Printf("Received message: %+v\n", msg)

			// Handle file upload
			if msg.Type == "file" && msg.File != nil {
				// Save file to uploads directory
				filePath := filepath.Join(uploadsDir, msg.File.Name)
				fileContent := []byte(msg.File.Content)
				if err := os.WriteFile(filePath, fileContent, 0644); err != nil {
					log.Println("Error saving file:", err)
					continue
				}

				// Add file message to conversation
				msg.Content = "Uploaded file: " + msg.File.Name
			}

			// Add user message to conversation
			conversation = append(conversation, msg)

			// Prepare request to DeepSeek API
			reqBody := DeepSeekRequest{
				Model:    model,
				Messages: conversation,
				Stream:   true,
			}

			jsonData, err := json.Marshal(reqBody)
			if err != nil {
				log.Println("Error marshaling request:", err)
				continue
			}

			log.Printf("Sending request to DeepSeek API: %s\n", string(jsonData))

			// Create HTTP request
			req, err := http.NewRequest("POST", baseURL+"/v1/chat/completions", bytes.NewBuffer(jsonData))
			if err != nil {
				log.Println("Error creating request:", err)
				continue
			}

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+apiKey)

			// Send request to DeepSeek API
			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				log.Println("Error sending request:", err)
				continue
			}
			defer resp.Body.Close()

			log.Printf("DeepSeek API response status: %s\n", resp.Status)

			// Add logging for the stream start
			log.Println("Sending stream_start message to frontend")

			// Send stream start message
			streamStart := Message{
				Type: "stream_start",
			}
			if err := conn.WriteJSON(streamStart); err != nil {
				log.Println("Error sending stream start:", err)
				break
			}

			// Read response stream
			scanner := bufio.NewScanner(resp.Body)
			var fullResponse strings.Builder
			var chunkCounter int

			for scanner.Scan() {
				chunkCounter++
				line := scanner.Text()
				if line == "" {
					continue
				}

				log.Printf("Received raw chunk %d: %s\n", chunkCounter, line)

				// Remove "data: " prefix if present
				if strings.HasPrefix(line, "data: ") {
					line = strings.TrimPrefix(line, "data: ")
				}

				// Skip "[DONE]" message
				if line == "[DONE]" {
					log.Println("Received [DONE] signal from DeepSeek API")
					break
				}

				var streamResp DeepSeekResponse
				if err := json.Unmarshal([]byte(line), &streamResp); err != nil {
					log.Printf("Error decoding stream response: %v\n", err)
					log.Printf("Problematic line: %s\n", line)
					continue
				}

				if len(streamResp.Choices) > 0 {
					content := streamResp.Choices[0].Delta.Content
					if content != "" {
						fullResponse.WriteString(content)

						// Log the content being sent to frontend
						log.Printf("Sending chunk %d to frontend: %q\n", chunkCounter, content)

						// Send content chunk
						streamContent := Message{
							Type:    "stream_content",
							Content: content,
							Role:    "assistant",
						}
						if err := conn.WriteJSON(streamContent); err != nil {
							log.Println("Error sending stream content:", err)
							break
						}
					}
				}
			}

			log.Printf("Full response accumulated: %q\n", fullResponse.String())
			log.Println("Sending stream_end message to frontend")

			if err := scanner.Err(); err != nil {
				log.Printf("Error reading response stream: %v\n", err)
			}

			// Send stream end message
			streamEnd := Message{
				Type: "stream_end",
			}
			if err := conn.WriteJSON(streamEnd); err != nil {
				log.Println("Error sending stream end:", err)
				break
			}

			// Add assistant's response to conversation
			assistantMsg := Message{
				Content: fullResponse.String(),
				Role:    "assistant",
			}
			conversation = append(conversation, assistantMsg)
		}
	})

	// Serve the main page
	r.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", nil)
	})

	log.Println("Server starting on :9000")
	if err := r.Run(":9000"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
