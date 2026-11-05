from flask import Flask, render_template, send_from_directory
import os

app = Flask(__name__, template_folder="templates", static_folder="static")


@app.route("/")
def home():
    return render_template("index.html")


# Keep support for direct /assets/<filename> requests as well
@app.route("/assets/<path:filename>")
def serve_assets(filename):
    return send_from_directory(os.path.join(app.root_path, "ASSETS"), filename)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
