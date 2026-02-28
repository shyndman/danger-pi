## ADDED Requirements

### Requirement: Compiled streaming multi-block payloads SHALL use mode-matched queue boundaries
Compiled streaming multi-block payloads SHALL be routed by delivery mode through the same `steer` and `followUp` queues used by single-message streaming submissions.

#### Scenario: Steer-mode compiled payload dequeues at steering boundary
- **WHEN** a compiled streaming multi-block payload is marked for `steer` delivery
- **THEN** it SHALL be dequeued at the same post-turn steering boundary used for queued steering messages

#### Scenario: Follow-up-mode compiled payload dequeues at follow-up boundary
- **WHEN** a compiled streaming multi-block payload is marked for `followUp` delivery
- **THEN** it SHALL be dequeued at the same follow-up boundary used for queued follow-up messages

#### Scenario: No parallel queue is introduced for compiled payloads
- **WHEN** compiled streaming multi-block payload support is enabled
- **THEN** compiled payload entries SHALL be stored in existing mode queues
- **AND** the system SHALL NOT require a separate compiled-payload queue to deliver them

### Requirement: Delivery ordering SHALL be deterministic within each mode queue
Within each delivery mode, compiled multi-block payloads and normal queued single-message payloads SHALL respect FIFO ordering.

#### Scenario: Earlier queued steer payload delivers first
- **WHEN** two steer-bound payloads are queued in sequence
- **THEN** the payload queued first SHALL be delivered first

#### Scenario: Earlier queued follow-up payload delivers first
- **WHEN** two follow-up-bound payloads are queued in sequence
- **THEN** the payload queued first SHALL be delivered first

### Requirement: Compiled payload delivery SHALL preserve idle-path semantics
When a compiled payload is delivered, the resulting behavior MUST match the existing non-streaming multi-block behavior for parsing outcomes, transcript effects, and prompt content semantics.

#### Scenario: Delivered compiled payload matches idle multi-block semantics
- **WHEN** a given multi-block submission is executed once in idle mode and once via streaming compile+defer delivery
- **THEN** the observable promptable content sequence SHALL be equivalent
- **AND** command execution side effects SHALL occur only at compile time in the streaming case

### Requirement: Queue drain MUST tolerate idle restart after agent end
If a mode-matched payload is queued after the active loop has already ended, the session SHALL resume processing so the payload still drains at the correct boundary.

#### Scenario: Follow-up payload queued after end still drains
- **WHEN** the agent loop reaches end state and a follow-up payload is queued shortly after
- **THEN** the session SHALL re-enter processing
- **AND** the payload SHALL drain through the follow-up dequeue path
