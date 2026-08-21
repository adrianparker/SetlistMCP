/**
 * Global test guard. Rate limit compliance is the whole point of this server, so no
 * test may ever reach setlist.fm or MusicBrainz for real. Tests that exercise HTTP
 * replace this with sinon.stub(global, 'fetch') and restore it afterwards.
 */
global.fetch = async () => {
  throw new Error('Unstubbed network call in tests. Stub global.fetch in the test that needs it.')
}
