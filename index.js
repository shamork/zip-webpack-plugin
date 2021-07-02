/**
 * @author Erik Desjardins
 * See LICENSE file in root directory for full license.
 */

'use strict';

const path = require('path');
const fs = require('fs')
const ModuleFilenameHelpers = require('webpack/lib/ModuleFilenameHelpers');
const webpack = require('webpack');
// Webpack 5 exposes the sources property to ensure the right version of webpack-sources is used.
// require('webpack-sources') approach may result in the "Cannot find module 'webpack-sources'" error.
const { RawSource } = webpack.sources || require('webpack-sources');
const yazl = require('yazl');

function ZipPlugin(options) {
	this.options = options || {};
}

ZipPlugin.prototype.apply = function (compiler) {
	const options = this.options;
	const isWebpack4 = webpack.version.startsWith('4.');

	if (options.pathPrefix && path.isAbsolute(options.pathPrefix)) {
		throw new Error('"pathPrefix" must be a relative path');
	}

	const process = function (compilation, callback) {
		// assets from child compilers will be included in the parent
		// so we should not run in child compilers
		if (compilation.compiler.isChild()) {
			callback();
			return;
		}

		// default to webpack's root output path if no path provided
		const outputPath = options.path || compilation.options.output.path;
		// default to webpack root filename if no filename provided, else the basename of the output path
		const outputFilename = options.filename || compilation.options.output.filename || path.basename(outputPath);

		const extension = '.' + (options.extension || 'zip');
		// combine the output path and filename
		const outputPathAndFilename = path.resolve(
			compilation.options.output.path, // ...supporting both absolute and relative paths
			outputPath,
			path.basename(outputFilename, '.zip') + extension // ...and filenames with and without a .zip extension
		);
		// // resolve a relative output path with respect to webpack's root output path
		// // since only relative paths are permitted for keys in `compilation.assets`
		// const relativeOutputPath = path.relative(
		// 	compilation.options.output.path,
		// 	outputPathAndFilename
		// );
		const zipFile = new yazl.ZipFile();

		// pipe() can be called any time after the constructor
		zipFile.outputStream.pipe(fs.createWriteStream(outputPathAndFilename)).on("close", function () {
			console.log("create zip file done: " + outputPathAndFilename);
		});

		const pathPrefix = options.pathPrefix || '';
		const pathMapper = options.pathMapper || function (x) { return x; };
		options.fromDir = options.fromDir || path.resolve(
			compilation.options.output.path, // ...supporting both absolute and relative paths
			outputPath);
		// populate the zip file with each asset
		if (options.fromDir) {
			let exist = fs.existsSync(options.fromDir);
			if (exist) {
				const walkSync = (currentDirPath, callback) => {
					fs.readdirSync(currentDirPath).forEach(function (name) {
						var filePath = path.join(currentDirPath, name);
						var stat = fs.statSync(filePath);
						if (stat.isFile()) {
							callback(filePath, stat);
						} else if (stat.isDirectory()) {
							walkSync(filePath, callback);
						}
					});
				}
				const baseDir = path.join(options.fromDir, '\\');
				console.log(`=============== walkSync, baseDir: ${baseDir} ==============`);
				walkSync(options.fromDir, (filePath, stat) => {
					if (outputPathAndFilename === filePath) {
						console.log('skip target zip')
						return;
					}
					const relativePath = path.relative(baseDir, filePath);
					if (!ModuleFilenameHelpers.matchObject({ include: options.include, exclude: options.exclude }, relativePath)) return;
					console.log('Add To Zip File: ' + pathMapper(relativePath) + ' => ' + path.join(pathPrefix, pathMapper(relativePath)));
					zipFile.addFile(
						filePath,
						path.join(pathPrefix, pathMapper(relativePath)),
						options.fileOptions
					)
				})
			}
		}

		zipFile.end(options.zipOptions);

		// accumulate each buffer containing a part of the zip file
		const bufs = [];

		zipFile.outputStream.on('data', function (buf) {
			bufs.push(buf);
		});

		zipFile.outputStream.on('end', function () {
			callback();
		});
	};

	if (isWebpack4) {
		compiler.hooks.afterEmit.tapAsync(ZipPlugin.name, process);
	} else {
		compiler.hooks.thisCompilation.tap(ZipPlugin.name, compilation => {
			compilation.hooks.processAssets.tapPromise(
				{
					name: ZipPlugin.name,
					stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
				},
				() => new Promise(resolve => process(compilation, resolve))
			);
		});
	}
};

module.exports = ZipPlugin;
