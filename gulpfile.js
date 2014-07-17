var argv       = require('yargs').argv;
var gulp       = require('gulp');
var rename     = require('gulp-rename');
var deploy     = require('gulp-gh-pages');
var uglify     = require('gulp-uglify');
var browserify = require('gulp-browserify');

var paths = {
  scripts: 'src'
};

gulp.task('scripts', function() {
    gulp.src("./src/catlogcat.js")
        .pipe(browserify({
            insertGlobals: true,
            debug: !argv.production
        }))
        .pipe(rename("main.js"))
        .pipe(gulp.dest("./site/js/"));
});

gulp.task('deploy', function() {
    gulp.src("./site/**/*")
        .pipe(deploy());
});

gulp.task('watch', function() {
    gulp.watch(paths.scripts, ['scripts']);
});

gulp.task('default', ['scripts']);

