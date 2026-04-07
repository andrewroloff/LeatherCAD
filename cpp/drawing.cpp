#include <vector>
#include <cmath>
#include <emscripten/emscripten.h>

struct Point
{
    double x, y;
};

struct Line
{
    int p1, p2;
};

// ---------------- STATE ----------------

static std::vector<Point> points;
static std::vector<Line> lines;

// Temporary buffer for JS access
static double *lineBuffer = nullptr;
static size_t lineBufferSize = 0;

// ---------------- HELPERS ----------------

static double dist(const Point &a, const Point &b)
{
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    return std::sqrt(dx * dx + dy * dy);
}

static bool is_line(const std::vector<Point> &stroke)
{
    if (stroke.size() < 2)
        return false;

    double straight = dist(stroke.front(), stroke.back());
    double path = 0;
    for (size_t i = 1; i < stroke.size(); i++)
        path += dist(stroke[i - 1], stroke[i]);

    return (path - straight) < 5.0; // tolerance
}

// ---------------- CORE API ----------------

extern "C"
{

    // Clear everything
    EMSCRIPTEN_KEEPALIVE
    void clear_scene()
    {
        points.clear();
        lines.clear();
    }

    // Create point
    EMSCRIPTEN_KEEPALIVE
    int create_point(double x, double y)
    {
        points.push_back({x, y});
        return points.size() - 1;
    }

    // Create line
    EMSCRIPTEN_KEEPALIVE
    int create_line(int p1, int p2)
    {
        lines.push_back({p1, p2});
        return lines.size() - 1;
    }

    // ---------------- RDP SIMPLIFICATION ----------------

    static double perpendicular_distance(const Point &p, const Point &a, const Point &b)
    {
        double dx = b.x - a.x;
        double dy = b.y - a.y;
        if (dx == 0 && dy == 0)
            return dist(p, a);

        double t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
        double projX = a.x + t * dx;
        double projY = a.y + t * dy;
        double px = p.x - projX;
        double py = p.y - projY;
        return std::sqrt(px * px + py * py);
    }

    static std::vector<Point> rdp(const std::vector<Point> &input, double epsilon)
    {
        if (input.size() < 3)
            return input;

        std::vector<bool> keep(input.size(), false);
        keep[0] = true;
        keep[input.size() - 1] = true;

        std::vector<std::pair<int, int>> stack;
        stack.push_back({0, (int)input.size() - 1});

        while (!stack.empty())
        {
            auto [start, end] = stack.back();
            stack.pop_back();

            double maxDist = 0.0;
            int index = -1;

            for (int i = start + 1; i < end; i++)
            {
                double d = perpendicular_distance(input[i], input[start], input[end]);
                if (d > maxDist)
                {
                    maxDist = d;
                    index = i;
                }
            }

            if (maxDist > epsilon && index != -1)
            {
                keep[index] = true;
                stack.push_back({start, index});
                stack.push_back({index, end});
            }
        }

        std::vector<Point> output;
        for (size_t i = 0; i < input.size(); i++)
            if (keep[i])
                output.push_back(input[i]);
        return output;
    }

    // ---------------- STROKE INPUT ----------------
    EMSCRIPTEN_KEEPALIVE
    void process_stroke(double *pts, int count)
    {
        std::vector<Point> stroke;
        for (int i = 0; i < count; i += 2)
            stroke.push_back({pts[i], pts[i + 1]});

        if (stroke.size() < 2)
            return;

        double epsilon = 5.0;
        std::vector<Point> simplified = rdp(stroke, epsilon);
        if (simplified.size() < 2)
            return;

        if (is_line(simplified))
        {
            int p1 = create_point(simplified.front().x, simplified.front().y);
            int p2 = create_point(simplified.back().x, simplified.back().y);
            create_line(p1, p2);
        }
        else
        {
            int prev = create_point(simplified[0].x, simplified[0].y);
            for (size_t i = 1; i < simplified.size(); i++)
            {
                int curr = create_point(simplified[i].x, simplified[i].y);
                create_line(prev, curr);
                prev = curr;
            }
        }
    }

    // ---------------- OUTPUT ----------------

    EMSCRIPTEN_KEEPALIVE
    int get_line_count()
    {
        return lines.size();
    }

    // Allocate internal buffer and return pointer to JS
    EMSCRIPTEN_KEEPALIVE
    double *get_lines_buffer()
    {
        size_t needed = lines.size() * 4;
        if (needed > lineBufferSize)
        {
            delete[] lineBuffer;
            lineBuffer = new double[needed];
            lineBufferSize = needed;
        }

        for (size_t i = 0; i < lines.size(); i++)
        {
            Line &l = lines[i];
            Point &a = points[l.p1];
            Point &b = points[l.p2];
            lineBuffer[i * 4 + 0] = a.x;
            lineBuffer[i * 4 + 1] = a.y;
            lineBuffer[i * 4 + 2] = b.x;
            lineBuffer[i * 4 + 3] = b.y;
        }

        return lineBuffer;
    }

    // Optional: free internal buffer (not required unless you want to reset)
    EMSCRIPTEN_KEEPALIVE
    void free_lines_buffer()
    {
        delete[] lineBuffer;
        lineBuffer = nullptr;
        lineBufferSize = 0;
    }

} // extern "C"