# Harness helper for Ruby: writes return values as JSON lines tagged with the run's marker. The server reads
# these lines and compares them to the expected values, which never enter the sandbox, so a line can only say
# what the code returned. Values are written by their type in the question ({k: :a, e: ...}), so a Hash's
# keys and a declared class's fields come out the same however the student built them.
module BQ
  REAL_OUT = STDOUT.dup
  @marker = ''
  @classes = {}

  def self.start(marker, classes)
    @marker = marker
    @classes = classes
  end

  def self.str(s)
    o = +'"'
    s.to_s.each_char do |c|
      o << case c
           when '"' then '\\"'
           when '\\' then '\\\\'
           when "\n" then '\\n'
           when "\t" then '\\t'
           else c.ord < 0x20 ? format('\\u%04x', c.ord) : c
           end
    end
    o << '"'
  end

  def self.enc(t, v, d = 0)
    return 'null' if v.nil?
    return '"..."' if d > 400
    case v
    when true then return 'true'
    when false then return 'false'
    when Integer then return v.to_s
    when Float then return v.finite? ? v.to_s : str(v.to_s)
    when String, Symbol then return str(v.to_s)
    end
    if t && t[:k] == :c && @classes[t[:n]]
      return '{' + @classes[t[:n]].map { |f, ft| "#{str(f)}:#{enc(ft, v.instance_variable_get("@#{f}"), d + 1)}" }.join(',') + '}'
    end
    if v.is_a?(Hash)
      vt = t && t[:k] == :m ? t[:v] : nil
      return '{' + v.map { |k, x| "#{str(k.to_s)}:#{enc(vt, x, d + 1)}" }.join(',') + '}'
    end
    if v.is_a?(Array)
      et = t && t[:k] == :a ? t[:e] : nil
      return '[' + v.map { |x| enc(et, x, d + 1) }.join(',') + ']'
    end
    str(v.inspect)
  end

  def self.out(rec)
    $stdout.flush
    REAL_OUT.syswrite("#{@marker}#{rec}\n")
  end

  def self.ok(i, t, v) = out("{\"i\":#{i},\"ok\":true,\"v\":#{enc(t, v)}}")
  def self.step(i, s, t, v) = out("{\"i\":#{i},\"s\":#{s},\"v\":#{enc(t, v)}}")
  def self.done(i) = out("{\"i\":#{i},\"ok\":true}")

  def self.place(e)
    line = (e.backtrace || []).find { |l| l.include?('solution.rb:') }
    m = line && line.match(/solution\.rb:(\d+)/)
    m ? " (solution.rb:#{m[1]})" : ''
  end

  def self.fail(i, e)
    msg = case e
          when SystemExit then "Stopped: the code called exit"
          when SystemStackError then 'Stack overflow: recursion too deep'
          else "#{e.class}: #{e.message}"[0, 500] + place(e)
          end
    out("{\"i\":#{i},\"ok\":false,\"err\":#{str(msg)}}")
  end

  # Their file didn't load: a syntax error, or an error at the top level.
  def self.broken(e)
    msg = e.is_a?(SyntaxError) ? e.message : "#{e.class}: #{e.message}" + place(e)
    out("{\"compile\":true,\"err\":#{str(msg.gsub(%r{/jobs/[^/\s]+/}, '')[0, 2000])}}")
  end

  def self.missing(want)
    gone = want.filter_map do |kind, name, extra|
      if kind == :f
        Object.private_method_defined?(name) || Object.method_defined?(name) ? nil : "Missing method #{extra}"
      elsif !Object.const_defined?(name) || !Object.const_get(name).is_a?(Class)
        "Missing class #{name}"
      else
        cls = Object.const_get(name)
        m = extra.reject { |x| cls.method_defined?(x) || cls.private_method_defined?(x) }
        m.empty? ? nil : m.map { |x| "#{name} needs a method #{x}" }.join("\n")
      end
    end
    out("{\"compile\":true,\"err\":#{str(gone.join("\n"))}}") unless gone.empty?
    !gone.empty?
  end

  # Big test arguments, made here instead of written out.
  def self.range(a, b, s) = (s > 0 ? a.step(b - 1, s) : a.step(b + 1, s)).to_a
end
