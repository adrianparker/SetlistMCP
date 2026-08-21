import { describe, it, beforeEach, afterEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { createDependencies, createServer, readVersion } from '../src/server.js'

/**
 * Drives the real MCP server through an in-process transport pair.
 *
 * This is the only test that exercises the parts unit tests cannot see: zod schemas
 * converted to JSON Schema for tools/list, argument validation before the handler
 * runs, and the SDK validating structuredContent against the declared outputSchema.
 */
describe('MCP server', () => {
  let deps
  let client
  let server
  let fetchStub

  beforeEach(async () => {
    // The guard in test/setup.js would otherwise reject any stray real request.
    fetchStub = sinon.stub(global, 'fetch')

    deps = await createDependencies({
      NODE_ENV: 'test',
      SETLISTFM_API_KEY: 'test-key',
      MUSICBRAINZ_CONTACT: 'test@example.com',
      SETLISTFM_MIN_INTERVAL_MS: '0',
      MUSICBRAINZ_MIN_INTERVAL_MS: '0'
    })

    server = createServer(deps)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client({ name: 'test-harness', version: '1.0.0' })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    fetchStub.restore()
  })

  describe('tools/list', () => {
    it('should advertise both tools', async () => {
      const { tools } = await client.listTools()

      expect(tools.map(tool => tool.name).sort()).to.deep.equal(['find_setlists', 'get_setlist'])
    })

    it('should convert the zod input schema into JSON Schema', async () => {
      const { tools } = await client.listTools()
      const findSetlists = tools.find(tool => tool.name === 'find_setlists')

      expect(findSetlists.inputSchema.type).to.equal('object')
      expect(findSetlists.inputSchema.properties).to.have.property('artist')
      expect(findSetlists.inputSchema.properties).to.have.property('city')
      expect(findSetlists.inputSchema.properties).to.have.property('date')
      expect(findSetlists.inputSchema.required).to.include('artist')
    })

    it('should carry the parameter descriptions the model relies on', async () => {
      const { tools } = await client.listTools()
      const findSetlists = tools.find(tool => tool.name === 'find_setlists')

      expect(findSetlists.inputSchema.properties.date.description).to.include('yyyy-MM-dd')
    })

    it('should mark both tools read-only', async () => {
      const { tools } = await client.listTools()

      tools.forEach(tool => {
        expect(tool.annotations.readOnlyHint).to.be.true
      })
    })

    it('should report the version from package.json', async () => {
      expect(deps.version).to.equal(readVersion())
    })
  })

  describe('tools/call', () => {
    it('should run a search end to end and validate the structured output', async () => {
      fetchStub.onFirstCall().resolves(jsonResponse({
        artists: [{ id: 'mbid-cure', name: 'The Cure', 'sort-name': 'Cure, The', score: 100 }]
      }))
      fetchStub.onSecondCall().resolves(jsonResponse({
        setlist: [{
          id: 'abc123',
          eventDate: '13-08-1992',
          url: 'https://www.setlist.fm/setlist/abc123.html',
          artist: { mbid: 'mbid-cure', name: 'The Cure' },
          venue: { name: 'Wellington Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } },
          sets: { set: [{ song: [{ name: 'Open' }, { name: 'High' }] }] }
        }],
        total: 1,
        page: 1,
        itemsPerPage: 20
      }))

      const result = await client.callTool({
        name: 'find_setlists',
        arguments: { artist: 'The Cure', city: 'Wellington', date: '1992-08-13' }
      })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.setlists[0]).to.include({
        id: 'abc123',
        eventDate: '1992-08-13',
        venue: 'Wellington Town Hall'
      })
      expect(result.content[0].text).to.include('The Cure')
    })

    it('should fetch a setlist by id end to end', async () => {
      fetchStub.resolves(jsonResponse({
        id: '6bd7ee5e',
        eventDate: '13-08-1992',
        url: 'https://www.setlist.fm/setlist/6bd7ee5e.html',
        artist: { mbid: 'mbid-cure', name: 'The Cure' },
        venue: { name: 'Wellington Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } },
        sets: { set: [{ song: [{ name: 'Open' }] }, { encore: 1, song: [{ name: 'Lovesong' }] }] }
      }))

      const result = await client.callTool({ name: 'get_setlist', arguments: { id: '6bd7ee5e' } })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.sets).to.have.lengthOf(2)
      expect(result.content[0].text).to.include('Encore 1')
    })

    it('should reject arguments that fail schema validation before the handler runs', async () => {
      const result = await client.callTool({
        name: 'find_setlists',
        arguments: { artist: 'The Cure', date: '13-08-1992' }
      })

      expect(result.isError).to.be.true
      expect(fetchStub.called).to.be.false
    })

    it('should reject a missing required argument', async () => {
      const result = await client.callTool({ name: 'find_setlists', arguments: {} })

      expect(result.isError).to.be.true
      expect(fetchStub.called).to.be.false
    })

    it('should reject a malformed setlist id without calling the API', async () => {
      const result = await client.callTool({ name: 'get_setlist', arguments: { id: '../../etc/passwd' } })

      expect(result.isError).to.be.true
      expect(fetchStub.called).to.be.false
    })

    it('should surface an empty search as a successful result', async () => {
      fetchStub.onFirstCall().resolves(jsonResponse({
        artists: [{ id: 'mbid-1', name: 'Obscure Band', score: 100 }]
      }))
      fetchStub.onSecondCall().resolves(notFoundResponse())

      const result = await client.callTool({
        name: 'find_setlists',
        arguments: { artist: 'Obscure Band', year: 1992 }
      })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.count).to.equal(0)
    })
  })
})

function jsonResponse (body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body
  }
}

function notFoundResponse () {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    headers: { get: () => null },
    text: async () => ''
  }
}
