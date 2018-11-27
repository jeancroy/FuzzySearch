module.exports = function(grunt) {

    grunt.initConfig({

        pkg: grunt.file.readJSON('package.json'),

        concat: {
            options: {
                separator: grunt.util.linefeed
            },

            dist: {
                src: ['src/banners/intro.js',
                      'src/init.js',
                      'src/*.js',
                      'src/optional/*.js',
                      'src/banners/outro.js'],

                dest: 'dist/FuzzySearch.js' //'dist/<%= pkg.name %>.js'
            }
        },

        uglify: {

            options: {

                mangle:{
                    except: ['jQuery', '$', '_' , 'define', 'require' , 'module', 'exports', 'amd' ]
                },

                compress:{},
                ASCIIOnly:true,
                preserveComments:'some'
            },

            dist: {
                files: {
                    //'dist/<%= pkg.name %>.min.js': ['<%= concat.dist.dest %>']
                    'dist/FuzzySearch.min.js' :  ['<%= concat.dist.dest %>']
                }
            }

        }



    });

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.registerTask('default', ['concat', 'uglify']);

};