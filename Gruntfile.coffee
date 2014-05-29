"use strict"
module.exports = (grunt) ->

  # Project configuration.
  grunt.initConfig
    coffee:
      lib:
        options:
          bare: true
          sourceMap: true
        expand: true
        src: ['src/**/*.coffee']
        dest: 'dest'
        ext: '.js'

      test:
        options:
          bare: true
        expand: true
        src: ['test/**/*.coffee']
        dest: 'test'
        ext: '.js'

    mochaTest:
      options:
        reporter: 'spec'
        require: 'coffee-script/register'
      all:
        src: ['test/**/*.coffee']

    coffeelint:
      lib: ['*.coffee', 'src/*.coffee', 'test/*.coffee']


  # These plugins provide necessary tasks.
  grunt.loadNpmTasks 'grunt-contrib-coffee'
  grunt.loadNpmTasks 'grunt-coffeelint'
  grunt.loadNpmTasks 'grunt-mocha-test'

  grunt.registerTask 'test', ['mochaTest']
  grunt.registerTask 'lint', ['coffeelint']
