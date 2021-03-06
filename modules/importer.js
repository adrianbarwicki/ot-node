// External modules
const PythonShell = require('python-shell');
const utilities = require('./utilities')();
const log = utilities.getLogger();
const config = utilities.getConfig();
const Mtree = require('./mtree')();
const storage = require('./storage')();
const blockchain = require('./blockchain')();
const signing = require('./blockchain_interface/ethereum/signing')();
const async = require('async');
const db = require('./database')();

const replication = require('./DataReplication');

module.exports = function () {
	let importer = {

		importJSON: async function (json_document, callback) {
			log.info('Entering importJSON');
			var graph = json_document;
			await db.createVertexCollection('ot_vertices', function(){});
			await db.createEdgeCollection('ot_edges', function(){});

			let vertices = graph.vertices;
			let edges = graph.edges;
			let data_id = graph.import_id;

			async.each(vertices, function (vertex, next) {
				db.addVertex('ot_vertices', vertex, function(import_status) {
					if(import_status == false) {
						db.updateDocumentImports('ot_vertices', vertex._key, data_id, function(update_status) {
							if(update_status == false)
							{
								log.info('Import error!');
								return;
							}
							else
							{
								next();
							}
						});
					}
					else {
						next();
					}
				});
			}, function(){

			});

			async.each(edges, function (edge, next) {
				db.addEdge('ot_edges', edge, function(import_status) {
					if(import_status == false) {
						db.updateDocumentImports('ot_edges', edge._key, data_id, function(update_status) {
							if(update_status == false)
							{
								log.info('Import error!');
								return;
							}
							else
							{
								next();
							}
						});
					}
					else {
						next();
					}
				});
			}, function(){
				log.info('JSON import complete');
			});

			utilities.executeCallback(callback,true);
		},

		importXML: async function async (ot_xml_document, callback) {

			var options = {
				mode: 'text',
				pythonPath: 'python3',
				scriptPath: 'importers/',
				args: [ot_xml_document]
			};

			PythonShell.run('v1.5.py', options, function(stderr, stdout){

				if (stderr) {
					log.info(stderr);
					utilities.executeCallback(callback, {
						message: 'Import failure',
						data: []
					});
					return;
				} else {
					log.info('[DC] Import complete');
					let result = JSON.parse(stdout);

					var vertices = result.vertices;
					var edges = result.edges;
					let data_id = result.import_id;
					

					let leaves = [];
					let hash_pairs = [];

					for(let i in vertices) {
						leaves.push(utilities.sha3(utilities.sortObject({identifiers: vertices[i].identifiers, data: vertices[i].data})));
						hash_pairs.push({key: vertices[i]._key, hash: utilities.sha3({identifiers: vertices[i].identifiers, data: vertices[i].data})});
					}

					let tree = new Mtree(hash_pairs);
					let root_hash = tree.root();

					log.info("Import id: " + data_id);
					log.info("Import hash: " + root_hash);
					storage.storeObject('Import_'+data_id, {vertices: hash_pairs, root_hash: root_hash}, function(response) {
						signing.signAndSend(data_id, utilities.sha3(data_id), utilities.sha3(tree.root())).then(response => {

							const graph = require('./graph')();
							const testing = require('./testing')();

							graph.encryptVertices(config.DH_NODE_IP, config.DH_NODE_PORT, vertices, result => {
								const encryptedVertices = result;
								log.info('[DC] Preparing to enter sendPayload');

								const data = {};
								data.vertices = vertices;
								data.edges = edges;
								data.data_id = data_id;

								replication.sendPayload(data, (result) => {
									log.info('[DC] Payload sent');
									log.info('[DC] Generating tests for DH');
								});
							});

						}).catch(err => {
							log.warn('Failed to write data fingerprint on blockchain!');
						});
					});

				}
			});
		}

	};

	return importer;
};

