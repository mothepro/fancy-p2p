# [Fancy P2P](https://mothepro.github.io/fancy-p2p)

> A simple way to discovery P2P (peer to peer) connections

## Projects

+ [Fancy P2P Demo](https://mothepro.github.io/fancy-p2p)
+ [Amazons](https://amazons.parkshade.com)

## Why

Direct connections between browsers is well supported with WebRTC, but this is difficult to set up and use.

## Caveats

Devices behind [strict NAT networks](https://developers.google.com/talk/libjingle/important_concepts?csw=1#portssocketsconnections) (roughly 8% of devices worldwide) can **not** create a direct peer to peer connection.

## Terminology

**Peer** A direct connection from one browser to another

**Client** Another browser in the same lobby. We can become peers if we both accept

## Install

`yarn add @mothepro/fancy-p2p`

## How to Use

Include the ES module on your page.

```html
<script type="module" src="//unpkg.com/@mothepro/fancy-p2p"></script>
```

Then in your application, initialize a P2P to find peers and connect with them.

```typescript
const
  /** My public server running `@mothepro/signaling-lobby`. */
  address = 'wss://ws.parkshade.com:443',

  /** STUNS to useful for testing. */
  stuns = [
    "stun:stun.stunprotocol.org",
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun2.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
    "stun:stun4.l.google.com:19302",
  ],

  /** The version of `@mothepro/signaling-lobby` the signaling server is running */
  version = '0.2.0',

  /** Only clients who use this string will be found in the lobby. */
  lobby = 'app-name@v1.0',

  /** P2P instance */
  p2p = new P2P({
    /** Name used to connect to lobby with. */
    name: 'Mo',

    /** STUN servers to use to initialize P2P connections */
    stuns,

    /** Lobby ID to use for this app */
    lobby,

    /** Settings for the signaling server */
    server: {
        /** The address of the signaling server */
        address,
        
        /** The version of `@mothepro/signaling-lobby` the signaling server is running */
        version,
    },

    /** Whether to use the signaling server as a fallback when a direct connection to peer can not be established. */
    fallback: false,

    /** Number of times to attempt to make an RTC connection, if negative direct p2p connections will not be attempted. */
    retries: 1,

    /** The number of milliseconds to wait before giving up on the connection. */
    timeout: 10 * 1000,
  })
```

The `p2p` has 4 possible states represented by the following.

```typescript
enum State {
  OFFLINE = 0,
  LOBBY = 1,
  LOADING = 2,
  READY = 3
}
```

The `p2p` instance exposes the following to listen for state changes.

```typescript
class P2P {
  readonly state: State

  /** Activated when the state changes, Cancels when finalized, Deactivates when error is throw. */
  readonly stateChange: Listener<State>
}
```

### Offline

No connection to server or peers.
Next state will be `LOBBY` or to fail.

### Lobby

We are now connected to the lobby. Now, listening to `Client`s connect and waiting to make or join a group.

```typescript
interface Client {
  /** Name of this client. */
  readonly name: Name

  /** Activated when a initiating a new group. */
  readonly proposals: SafeListener<{

      /** The other members in this group, including me. */
      members: Client[]

      /** Function to accept or reject the group, not present if you created the group */
      action?(accept: boolean): void

      /** Activated with the Client who just accepted the group proposal. Deactivates when someone rejects. */
      ack: Listener<Client>
  }>

  /**
   * Whether this client represents you in the lobby.
   * When false this is another client and proposals are initiated by them.
   */
  readonly isYou: boolean
}
```

*The first client to connect is always "you".*

The `p2p` instance provides a Listener to find new clients and a `proposeGroup` method which takes a list of clients to group with.

```typescript
class P2P {
  /** Activated when a client joins the lobby. */
  readonly lobbyConnection: SafeListener<SimpleClient>
  
  /** Propose a group with other clients connected to this lobby. */
  proposeGroup(...members: SimpleClient[]): void

  /** Whether a group with the following memebers has been proposed or answered. */
  groupExists(...members: SimpleClient[]): boolean
}
```

Which can be used to find clients and monitor when they propose, accept or reject groups or leave the lobby.

<details>

  <summary>Example: Listening to clients</summary>

```typescript
async function bindClientProposals(client: Client) {
  for await (const { members, ack, action } of client.proposals) {
    const groupName =  members.map(client => client.name).join(', ') + ' & you'
    console.log('Group proposed for ', groupName)
    this.bindProposalAcks(groupName, ack)

    if (action) // not present if I created the group
      action(confirm('Want to join group with ' + groupName))
  }
  console.log(client.name, 'has left the lobby')
}

async function bindProposalAcks(groupName: string, ack: Listener<Client>) {
  try {
    for await (const client of ack)
      console.log(client.name, 'accepted invitation with', groupName)
  } catch (err) {
    if (err.client) // if present, this is the client who rejected
      console.error(err, err.client.name, 'rejected invitation to group with', groupName)
    else
      console.error(err, 'Group closed with', groupName)
  }
}

for await (const client of p2p.lobbyConnection) {
  console.log(client.name, 'has joined the lobby')
  this.bindClientProposals(client)
}
```

</details>

Next state will be `LOADING` if group is made or `OFFLINE` if kicked from server for inactivity.

### Loading

Happens once every client accepts the group.
Time to create direct P2P connections with everyone who accepted

Next state will be `READY` if successful or fail if a direct connection with all isn't made.

### Ready

The direct connections with peers are set and we can now broadcast messages and generate random numbers together.

```typescript
interface Peer<T extends string | ArrayBuffer | Blob> {
    /** Name of the new peer. */
    readonly name: Name

    /** Send data to activate the `message` listener for the peer. */
    send(data: T): void

    /** Activates when a message is received for this peer. Cancels once the connection is closed. */
    readonly message: Listener<T>

    /**
     * Whether this peer represents a "connection" to you.
     * When false this is another peer and data is sent through the wire.
     */
    readonly isYou: boolean

    /** Close the connection with this peer. */
    close(): void;
}
```

The `peers` member in the `p2p` instance is now a list of `Peer`s in a random order.
This order is consistent for all the peers though (Useful for turn based applications).

The `p2p` instance also provides the `broadcast` & `random` helper functions.

```typescript
class P2P<T extends ArrayBuffer | string | Blob> {
    /** The peers who's connections are still open */
    readonly peers: Peer<T>[]

    /**
     * Generates a random number in [0,1). Same as Math.random()
     * If `isInt` is true, than a integer in range [-2 ** 31, 2 ** 31) is generated.
     *
     * This value will be the same across all the other connected peers.
     */
    random(isInt?: boolean): number

    /** Send data to all connected peers. Including you by default */
    broadcast(data: T, includeSelf?: boolean): void
}
```

<details>

  <summary>Example: Listening to peers</summary>

```typescript
async function bindPeerMessages(peer: Peer) {
  try {
    for await (const data of peer.message)
      console.log(peer.name, 'sent', data)
  } catch (err) {
    console.error(err)
  }
  console.log('Closed direct connection with', peer.name)
}

for (const peer of p2p.peers)
  this.bindPeerMessages(peer)
```

</details>

## Roadmap

+ Test RTC possibility before starting server connection
+ Support trickle ICE
+ Improve peer lib `simple-peer` is messes with buffer
