package websocket

import (
	"context"
	"log"

	"nhooyr.io/websocket"
)

const sendBufSize = 256

// Client represents a single connected WebSocket user session.
// One user may have multiple Clients (multi-device).
type Client struct {
	userID string
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
}

func newClient(userID string, hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		userID: userID,
		hub:    hub,
		conn:   conn,
		send:   make(chan []byte, sendBufSize),
	}
}

// readPump pumps messages from the WebSocket connection into the hub's inbound channel.
// Runs in its own goroutine per client.
func (c *Client) readPump(ctx context.Context) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()
	for {
		_, msg, err := c.conn.Read(ctx)
		if err != nil {
			log.Printf("[ws] readPump disconnect userID=%s: %v", c.userID, err)
			break
		}
		c.hub.inbound <- inboundMsg{client: c, data: msg}
	}
}

// writePump pumps messages from the client's send channel to the WebSocket connection.
// Runs in its own goroutine per client.
func (c *Client) writePump(ctx context.Context) {
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				// Hub closed the channel — close the connection.
				c.conn.Close(websocket.StatusNormalClosure, "")
				return
			}
			if err := c.conn.Write(ctx, websocket.MessageText, msg); err != nil {
				log.Printf("[ws] writePump error userID=%s: %v", c.userID, err)
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
