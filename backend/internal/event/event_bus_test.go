package event_test

import (
	"sync"
	"testing"

	"lost-pets/internal/event"
)

func TestEventBus_PublishSinListeners(t *testing.T) {
	bus := event.NewEventBus()

	// No debe hacer panic ni bloquear
	bus.Publish("report.created", event.ReportCreatedEvent{PetName: "Firulais"})
}

func TestEventBus_PublishConMultiplesListeners(t *testing.T) {
	bus := event.NewEventBus()

	var wg sync.WaitGroup
	received := make([]string, 0, 2)
	var mu sync.Mutex

	wg.Add(2)
	bus.Subscribe("report.created", func(payload interface{}) {
		defer wg.Done()
		ev := payload.(event.ReportCreatedEvent)
		mu.Lock()
		received = append(received, "handler1:"+ev.PetName)
		mu.Unlock()
	})
	bus.Subscribe("report.created", func(payload interface{}) {
		defer wg.Done()
		ev := payload.(event.ReportCreatedEvent)
		mu.Lock()
		received = append(received, "handler2:"+ev.PetName)
		mu.Unlock()
	})

	bus.Publish("report.created", event.ReportCreatedEvent{PetName: "Rex"})

	wg.Wait()

	if len(received) != 2 {
		t.Fatalf("esperaba 2 handlers ejecutados, obtuve %d", len(received))
	}
}

func TestEventBus_PanicEnListenerNoPropaganAlCaller(t *testing.T) {
	bus := event.NewEventBus()

	var wg sync.WaitGroup
	wg.Add(2)

	// Handler 1: hace panic
	bus.Subscribe("message.sent", func(payload interface{}) {
		defer wg.Done()
		panic("boom")
	})

	// Handler 2: debe ejecutarse igual
	executed := false
	bus.Subscribe("message.sent", func(payload interface{}) {
		defer wg.Done()
		executed = true
	})

	// No debe panic en el caller
	bus.Publish("message.sent", event.MessageSentEvent{Preview: "hola"})

	wg.Wait()

	if !executed {
		t.Error("el segundo handler no se ejecutó después del panic del primero")
	}
}

func TestEventBus_SubscribeSync_CorreInlineAntesDeQuePublishRetorne(t *testing.T) {
	bus := event.NewEventBus()

	// Sin WaitGroup ni sleep a propósito: un handler síncrono DEBE haber corrido
	// inline, antes de que Publish retorne. Si fuera async, ran seguiría false.
	ran := false
	bus.SubscribeSync("pet.lost", func(_ interface{}) {
		ran = true
	})

	bus.Publish("pet.lost", event.PetLostEvent{})

	if !ran {
		t.Fatal("el handler SubscribeSync no corrió sincrónicamente antes de retornar Publish")
	}
}

func TestEventBus_SubscribeSync_PanicNoPropaganAlCaller(t *testing.T) {
	bus := event.NewEventBus()

	bus.SubscribeSync("pet.lost", func(_ interface{}) {
		panic("boom")
	})

	// El panic de un handler síncrono no debe propagar al caller (request).
	bus.Publish("pet.lost", event.PetLostEvent{})
}

func TestEventBus_SubscribeSync_YAsyncCoexisten(t *testing.T) {
	bus := event.NewEventBus()

	syncRan := false
	bus.SubscribeSync("pet.lost", func(_ interface{}) { syncRan = true })

	var wg sync.WaitGroup
	wg.Add(1)
	asyncRan := false
	bus.Subscribe("pet.lost", func(_ interface{}) {
		defer wg.Done()
		asyncRan = true
	})

	bus.Publish("pet.lost", event.PetLostEvent{})

	// El síncrono ya corrió inline.
	if !syncRan {
		t.Error("el handler síncrono no corrió inline")
	}
	// El async corre en goroutine — esperamos.
	wg.Wait()
	if !asyncRan {
		t.Error("el handler asíncrono no corrió")
	}
}
