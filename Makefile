# Edit for your paths
EMSCRIPTEN=~/emscripten
EMCC=$(EMSCRIPTEN)/em++ -O2 
#JS_COMPILER = java -Xmx512M -jar lib/google-compiler/compiler.jar --charset UTF-8

all: thinplatespline.js

thinplatespline.js: tps/thinplatespline.cpp js/pre.js js/post.js
	$(EMCC) $(CFLAGS) --bind tps/thinplatespline.cpp --pre-js js/pre.js --post-js js/post.js -o js/thinplatespline.js

#min.js: js/thinplatespline.js
#	rm -f js/thinplatespline.min.js
#	$(JS_COMPILER) --js js/thinplatespline.js >> js/thinplatespline.min.js

clean:
	rm js/thinplatespline.js
