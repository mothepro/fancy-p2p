import dev from './dev-server-config.json'
import prod from './prod-server-config.json'

// Decide which server config to use
export default location.protocol == 'https:' ? prod : dev
